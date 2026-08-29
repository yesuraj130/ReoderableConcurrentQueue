using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;

namespace ReorderableCollections
{
    public class ReorderableConcurrentQueue<T> : IEnumerable<T> where T : class
    {
        private const int SegmentSize = 1024; // 2^10
        private static long s_segmentIdCounter;

        private volatile ReorderableSegment<T> _headSegment;
        private volatile ReorderableSegment<T> _tailSegment;

        private SlotHandle<T> _logicalHead = SlotHandle<T>.Null;
        private SlotHandle<T> _logicalTail = SlotHandle<T>.Null;

        // Fallback directory if T does not implement IHasSlotHandle<T>
        private readonly ConcurrentDictionary<T, SlotHandle<T>> _directory = 
            new ConcurrentDictionary<T, SlotHandle<T>>();

        private int _count;

        public ReorderableConcurrentQueue()
        {
            var initial = new ReorderableSegment<T>(Interlocked.Increment(ref s_segmentIdCounter), SegmentSize);
            _headSegment = initial;
            _tailSegment = initial;
        }

        public int Count => Math.Max(0, Volatile.Read(ref _count));
        public bool IsEmpty => Count == 0;

        public void Enqueue(T item)
        {
            if (item == null) throw new ArgumentNullException(nameof(item));

            while (true)
            {
                var tail = _tailSegment;
                if (tail.TryAllocateSlot(out int slotIdx))
                {
                    ref var slot = ref tail._slots[slotIdx];
                    var currentHandle = new SlotHandle<T>(tail, slotIdx);

                    slot.Item = item;
                    slot.Next = SlotHandle<T>.Null;

                    // Lock-Free atomic sequence wiring using CompareExchange loop
                    while (true)
                    {
                        var prevTail = Volatile.Read(ref _logicalTail);
                        slot.Prev = prevTail;
                        if (Interlocked.CompareExchange(ref _logicalTail, currentHandle, prevTail) == prevTail)
                        {
                            if (prevTail.IsNull)
                            {
                                _logicalHead = currentHandle;
                            }
                            else
                            {
                                ref var prevSlot = ref prevTail.Segment._slots[prevTail.SlotIndex];
                                prevSlot.Next = currentHandle;
                            }
                            break;
                        }
                    }

                    Volatile.Write(ref slot.State, ReorderableSegment<T>.StateReady);

                    // Zero-Allocation Hybrid mode: bypass directory entirely if interface is implemented!
                    if (item is IHasSlotHandle<T> reorderable)
                    {
                        reorderable.SlotHandle = currentHandle;
                    }
                    else
                    {
                        _directory[item] = currentHandle;
                    }

                    Interlocked.Increment(ref _count);
                    return;
                }

                // Grow segment
                lock (tail)
                {
                    if (tail._nextSegment == null)
                    {
                        var newSeg = new ReorderableSegment<T>(
                            Interlocked.Increment(ref s_segmentIdCounter), SegmentSize);
                        tail._nextSegment = newSeg;
                        _tailSegment = newSeg;
                    }
                }
            }
        }

        public bool TryDequeue(out T item)
        {
            var spinner = new SpinWait();

            while (true)
            {
                var head = _logicalHead;
                if (head.IsNull || Count == 0)
                {
                    item = null;
                    return false;
                }

                ref var slot = ref head.Segment._slots[head.SlotIndex];
                int state = Interlocked.CompareExchange(
                    ref slot.State, 
                    ReorderableSegment<T>.StateClaimed, 
                    ReorderableSegment<T>.StateReady);

                if (state == ReorderableSegment<T>.StateReady)
                {
                    item = slot.Item;
                    slot.Item = null;

                    if (item is IHasSlotHandle<T> reorderable)
                    {
                        reorderable.SlotHandle = SlotHandle<T>.Null;
                    }
                    else
                    {
                        _directory.TryRemove(item, out _);
                    }

                    // Lock-Free logical head advancement using CAS exchange
                    var nextHandle = slot.Next;
                    if (Interlocked.CompareExchange(ref _logicalHead, nextHandle, head) == head)
                    {
                        if (!nextHandle.IsNull)
                        {
                            ref var nextSlot = ref nextHandle.Segment._slots[nextHandle.SlotIndex];
                            nextSlot.Prev = SlotHandle<T>.Null;
                        }
                        else
                        {
                            Interlocked.CompareExchange(ref _logicalTail, SlotHandle<T>.Null, head);
                        }
                    }

                    slot.Next = SlotHandle<T>.Null;
                    slot.Prev = SlotHandle<T>.Null;
                    Volatile.Write(ref slot.State, ReorderableSegment<T>.StateFree);

                    head.Segment.OnSlotFreed();
                    Interlocked.Decrement(ref _count);

                    if (head.Segment.IsEmpty && head.Segment._nextSegment != null)
                    {
                        _headSegment = head.Segment._nextSegment;
                    }

                    return true;
                }

                if (state == ReorderableSegment<T>.StateLockedReorder)
                {
                    spinner.SpinOnce();
                    continue;
                }

                spinner.SpinOnce();
            }
        }

        public bool TryMoveBefore(T sourceItem, T targetDestination)
        {
            if (sourceItem == null || targetDestination == null || ReferenceEquals(sourceItem, targetDestination))
                return false;

            SlotHandle<T> srcHandle;
            SlotHandle<T> destHandle;

            if (sourceItem is IHasSlotHandle<T> srcReorderable)
            {
                srcHandle = srcReorderable.SlotHandle;
            }
            else
            {
                if (!_directory.TryGetValue(sourceItem, out srcHandle)) return false;
            }

            if (targetDestination is IHasSlotHandle<T> destReorderable)
            {
                destHandle = destReorderable.SlotHandle;
            }
            else
            {
                if (!_directory.TryGetValue(targetDestination, out destHandle)) return false;
            }

            if (srcHandle.IsNull || destHandle.IsNull) return false;

            // Ordered lock acquisition keys to guarantee deadlock freedom
            long keySrc = (srcHandle.Segment.Id << 32) | (uint)srcHandle.SlotIndex;
            long keyDest = (destHandle.Segment.Id << 32) | (uint)destHandle.SlotIndex;

            ref var srcSlot = ref srcHandle.Segment._slots[srcHandle.SlotIndex];
            ref var destSlot = ref destHandle.Segment._slots[destHandle.SlotIndex];

            // Canonical lock acquisition
            ref var firstSlot = ref (keySrc < keyDest ? ref srcSlot : ref destSlot);
            ref var secondSlot = ref (keySrc < keyDest ? ref destSlot : ref srcSlot);

            if (Interlocked.CompareExchange(ref firstSlot.State, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
                return false;

            if (Interlocked.CompareExchange(ref secondSlot.State, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
            {
                Volatile.Write(ref firstSlot.State, ReorderableSegment<T>.StateReady);
                return false;
            }

            try
            {
                var prevSrc = srcSlot.Prev;
                var nextSrc = srcSlot.Next;

                if (!prevSrc.IsNull) prevSrc.Segment._slots[prevSrc.SlotIndex].Next = nextSrc;
                if (!nextSrc.IsNull) nextSrc.Segment._slots[nextSrc.SlotIndex].Prev = prevSrc;

                if (_logicalHead.Equals(srcHandle)) _logicalHead = nextSrc;
                if (_logicalTail.Equals(srcHandle)) _logicalTail = prevSrc;

                var prevDest = destSlot.Prev;

                if (!prevDest.IsNull) prevDest.Segment._slots[prevDest.SlotIndex].Next = srcHandle;
                srcSlot.Prev = prevDest;
                srcSlot.Next = destHandle;
                destSlot.Prev = srcHandle;

                if (_logicalHead.Equals(destHandle)) _logicalHead = srcHandle;

                return true;
            }
            finally
            {
                Volatile.Write(ref secondSlot.State, ReorderableSegment<T>.StateReady);
                Volatile.Write(ref firstSlot.State, ReorderableSegment<T>.StateReady);
            }
        }

        public IEnumerator<T> GetEnumerator()
        {
            var current = _logicalHead;
            while (!current.IsNull)
            {
                var item = current.Segment._slots[current.SlotIndex].Item;
                if (item != null) yield return item;
                current = current.Segment._slots[current.SlotIndex].Next;
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
}
