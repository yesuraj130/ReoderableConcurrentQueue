using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;

namespace ReorderableCollections
{
    public class ReorderableConcurrentQueue<T> : IEnumerable<T> where T : class
    {
        private const int InitialSegmentSize = 32;
        private const int MaxSegmentSize = 4096;
        private static long s_segmentIdCounter;
        private static readonly bool s_isIntrusive = typeof(IHasSlotHandle<T>).IsAssignableFrom(typeof(T));

        private volatile ReorderableSegment<T> _headSegment;
        private volatile ReorderableSegment<T> _tailSegment;

        private int _count;

        public ReorderableConcurrentQueue()
        {
            var initial = new ReorderableSegment<T>(Interlocked.Increment(ref s_segmentIdCounter), InitialSegmentSize);
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
                    slot.Item = item;
                    slot.NextSlot = -1;
                    slot.NextSegment = null;
                    slot.PrevSlot = -1;
                    slot.PrevSegment = null;
                    Volatile.Write(ref slot.Sequence, ReorderableSegment<T>.StateReady);

                    if (s_isIntrusive)
                    {
                        ((IHasSlotHandle<T>)item).SlotHandle = tail.GetHandle(slotIdx);
                    }

                    Interlocked.Increment(ref _count);
                    return;
                }

                // Grow segment dynamically
                if (tail._nextSegment != null)
                {
                    _tailSegment = tail._nextSegment;
                }
                else
                {
                    lock (tail)
                    {
                        if (tail._nextSegment == null)
                        {
                            int nextCapacity = Math.Min(MaxSegmentSize, tail.Capacity * 2);
                            var newSeg = new ReorderableSegment<T>(
                                Interlocked.Increment(ref s_segmentIdCounter), nextCapacity);
                            newSeg._prevSegment = tail;
                            tail._nextSegment = newSeg;
                            _tailSegment = newSeg;
                        }
                    }
                }
            }
        }

        public bool TryDequeue(out T? item)
        {
            var spinner = new SpinWait();

            while (true)
            {
                if (Volatile.Read(ref _count) <= 0)
                {
                    item = null;
                    return false;
                }

                var headSeg = _headSegment;

                // Fast-Path (Single-CAS ring dequeue for non-reordered streams)
                if (!headSeg._hasReordered)
                {
                    int slotIdx = Interlocked.Increment(ref headSeg._headIndex);
                    if (slotIdx < headSeg.Capacity)
                    {
                        ref var slot = ref headSeg._slots[slotIdx];

                        while (Volatile.Read(ref slot.Sequence) == ReorderableSegment<T>.StateFree)
                        {
                            spinner.SpinOnce();
                        }

                        int seq = Interlocked.CompareExchange(
                            ref slot.Sequence,
                            ReorderableSegment<T>.StateClaimed,
                            ReorderableSegment<T>.StateReady);

                        if (seq == ReorderableSegment<T>.StateReady)
                        {
                            item = slot.Item;
                            slot.Item = null;

                            if (s_isIntrusive && item is IHasSlotHandle<T> reorderable)
                            {
                                reorderable.SlotHandle = SlotHandle<T>.Null;
                            }

                            headSeg.OnSlotFreed();
                            Interlocked.Decrement(ref _count);

                            if (slotIdx == headSeg.Capacity - 1 && headSeg._nextSegment != null)
                            {
                                _headSegment = headSeg._nextSegment;
                            }

                            return true;
                        }

                        if (seq == ReorderableSegment<T>.StateLockedReorder)
                        {
                            spinner.SpinOnce();
                            continue;
                        }
                    }
                    else
                    {
                        if (headSeg._nextSegment != null)
                        {
                            _headSegment = headSeg._nextSegment;
                            continue;
                        }
                        item = null;
                        return false;
                    }
                }
                else
                {
                    // Reordered Dequeue Path
                    if (TryDequeueReordered(headSeg, out item))
                    {
                        return true;
                    }
                    
                    if (headSeg.IsEmpty && headSeg._nextSegment != null)
                    {
                        _headSegment = headSeg._nextSegment;
                        continue;
                    }
                    
                    item = null;
                    return false;
                }
            }
        }

        private bool TryDequeueReordered(ReorderableSegment<T> segment, out T? item)
        {
            var spinner = new SpinWait();
            int tailLimit = Math.Min(segment.Capacity, Volatile.Read(ref segment._tailIndex) + 1);

            for (int i = 0; i < tailLimit; i++)
            {
                ref var slot = ref segment._slots[i];
                if (Volatile.Read(ref slot.Sequence) == ReorderableSegment<T>.StateReady && slot.Item != null)
                {
                    // Check if this slot has a predecessor that should be dequeued before it
                    if (slot.PrevSlot >= 0 && slot.PrevSegment != null)
                    {
                        ref var prevSlot = ref slot.PrevSegment._slots[slot.PrevSlot];
                        if (Volatile.Read(ref prevSlot.Sequence) == ReorderableSegment<T>.StateReady && prevSlot.Item != null)
                        {
                            // Predecessor takes priority, dequeue predecessor first
                            continue;
                        }
                    }

                    int seq = Interlocked.CompareExchange(
                        ref slot.Sequence,
                        ReorderableSegment<T>.StateClaimed,
                        ReorderableSegment<T>.StateReady);

                    if (seq == ReorderableSegment<T>.StateReady)
                    {
                        item = slot.Item;
                        slot.Item = null;

                        if (s_isIntrusive && item is IHasSlotHandle<T> reorderable)
                        {
                            reorderable.SlotHandle = SlotHandle<T>.Null;
                        }

                        segment.OnSlotFreed();
                        Interlocked.Decrement(ref _count);
                        return true;
                    }
                }
            }

            // Fallback scan across next segments if this segment is exhausted
            if (segment._nextSegment != null)
            {
                return TryDequeueReordered(segment._nextSegment, out item);
            }

            item = null;
            return false;
        }

        public bool TryMoveBefore(T sourceItem, T targetDestination)
        {
            if (sourceItem == null || targetDestination == null || ReferenceEquals(sourceItem, targetDestination))
                return false;

            SlotHandle<T>? srcHandle = null;
            SlotHandle<T>? destHandle = null;

            if (s_isIntrusive)
            {
                srcHandle = ((IHasSlotHandle<T>)sourceItem).SlotHandle;
                destHandle = ((IHasSlotHandle<T>)targetDestination).SlotHandle;
            }
            else
            {
                // Find items in active segments
                var curSeg = _headSegment;
                while (curSeg != null && (srcHandle == null || destHandle == null))
                {
                    int tailLimit = Math.Min(curSeg.Capacity, Volatile.Read(ref curSeg._tailIndex) + 1);
                    for (int i = 0; i < tailLimit; i++)
                    {
                        ref var slot = ref curSeg._slots[i];
                        if (slot.Item != null && Volatile.Read(ref slot.Sequence) == ReorderableSegment<T>.StateReady)
                        {
                            if (srcHandle == null && ReferenceEquals(slot.Item, sourceItem))
                            {
                                srcHandle = curSeg.GetHandle(i);
                            }
                            else if (destHandle == null && ReferenceEquals(slot.Item, targetDestination))
                            {
                                destHandle = curSeg.GetHandle(i);
                            }
                        }
                    }
                    curSeg = curSeg._nextSegment;
                }
            }

            if (srcHandle == null || destHandle == null || srcHandle.IsNull || destHandle.IsNull)
                return false;

            srcHandle.Segment._hasReordered = true;
            destHandle.Segment._hasReordered = true;

            long keySrc = (srcHandle.Segment.Id << 32) | (uint)srcHandle.SlotIndex;
            long keyDest = (destHandle.Segment.Id << 32) | (uint)destHandle.SlotIndex;

            ref var srcSlot = ref srcHandle.Segment._slots[srcHandle.SlotIndex];
            ref var destSlot = ref destHandle.Segment._slots[destHandle.SlotIndex];

            ref var firstSlot = ref (keySrc < keyDest ? ref srcSlot : ref destSlot);
            ref var secondSlot = ref (keySrc < keyDest ? ref destSlot : ref srcSlot);

            if (Interlocked.CompareExchange(ref firstSlot.Sequence, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
                return false;

            if (Interlocked.CompareExchange(ref secondSlot.Sequence, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
            {
                Volatile.Write(ref firstSlot.Sequence, ReorderableSegment<T>.StateReady);
                return false;
            }

            try
            {
                // Splice source out of existing custom links
                if (srcSlot.PrevSlot >= 0 && srcSlot.PrevSegment != null)
                {
                    ref var prev = ref srcSlot.PrevSegment._slots[srcSlot.PrevSlot];
                    prev.NextSlot = srcSlot.NextSlot;
                    prev.NextSegment = srcSlot.NextSegment;
                }
                if (srcSlot.NextSlot >= 0 && srcSlot.NextSegment != null)
                {
                    ref var next = ref srcSlot.NextSegment._slots[srcSlot.NextSlot];
                    next.PrevSlot = srcSlot.PrevSlot;
                    next.PrevSegment = srcSlot.PrevSegment;
                }

                // Splice source before target
                srcSlot.NextSlot = destHandle.SlotIndex;
                srcSlot.NextSegment = destHandle.Segment;
                srcSlot.PrevSlot = destSlot.PrevSlot;
                srcSlot.PrevSegment = destSlot.PrevSegment;

                if (destSlot.PrevSlot >= 0 && destSlot.PrevSegment != null)
                {
                    ref var prevDest = ref destSlot.PrevSegment._slots[destSlot.PrevSlot];
                    prevDest.NextSlot = srcHandle.SlotIndex;
                    prevDest.NextSegment = srcHandle.Segment;
                }

                destSlot.PrevSlot = srcHandle.SlotIndex;
                destSlot.PrevSegment = srcHandle.Segment;

                return true;
            }
            finally
            {
                Volatile.Write(ref secondSlot.Sequence, ReorderableSegment<T>.StateReady);
                Volatile.Write(ref firstSlot.Sequence, ReorderableSegment<T>.StateReady);
            }
        }

        public IEnumerator<T> GetEnumerator()
        {
            var curSeg = _headSegment;
            while (curSeg != null)
            {
                int tailLimit = Math.Min(curSeg.Capacity, Volatile.Read(ref curSeg._tailIndex) + 1);
                for (int i = 0; i < tailLimit; i++)
                {
                    var item = curSeg._slots[i].Item;
                    if (item != null && Volatile.Read(ref curSeg._slots[i].Sequence) == ReorderableSegment<T>.StateReady)
                    {
                        yield return item;
                    }
                }
                curSeg = curSeg._nextSegment;
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
}

