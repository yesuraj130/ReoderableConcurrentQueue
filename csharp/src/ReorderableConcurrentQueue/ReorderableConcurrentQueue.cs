using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;

namespace ReorderableCollections
{
    internal static class IntrusiveHelper<T> where T : class
    {
        public static readonly bool IsIntrusive = typeof(IHasSlotHandle<T>).IsAssignableFrom(typeof(T));
    }

    public class ReorderableConcurrentQueue<T> : IEnumerable<T> where T : class
    {
        private const int InitialSegmentSize = 32;
        private const int MaxSegmentSize = 1024;
        private static long s_segmentIdCounter;
        private static readonly bool s_isIntrusive = IntrusiveHelper<T>.IsIntrusive;

        private volatile ReorderableSegment<T> _headSegment;
        private volatile ReorderableSegment<T> _tailSegment;

        public ReorderableConcurrentQueue()
        {
            var initial = new ReorderableSegment<T>(Interlocked.Increment(ref s_segmentIdCounter), InitialSegmentSize);
            _headSegment = initial;
            _tailSegment = initial;
        }

        public int Count
        {
            get
            {
                int count = 0;
                var cur = _headSegment;
                while (cur != null)
                {
                    int head = Math.Max(0, Volatile.Read(ref cur._head.Value) + 1);
                    int tail = Math.Min(cur.Capacity, Volatile.Read(ref cur._tail.Value) + 1);
                    if (tail > head)
                    {
                        for (int i = head; i < tail; i++)
                        {
                            if (Volatile.Read(ref cur._slots[i].Sequence) == ReorderableSegment<T>.StateReady)
                            {
                                count++;
                            }
                        }
                    }
                    cur = cur._nextSegment;
                }
                return count;
            }
        }

        public bool IsEmpty => !TryPeek(out _);

        public bool TryPeek(out T? result)
        {
            var cur = _headSegment;
            while (cur != null)
            {
                int head = Math.Max(0, Volatile.Read(ref cur._head.Value) + 1);
                int tail = Math.Min(cur.Capacity, Volatile.Read(ref cur._tail.Value) + 1);
                for (int i = head; i < tail; i++)
                {
                    if (Volatile.Read(ref cur._slots[i].Sequence) == ReorderableSegment<T>.StateReady)
                    {
                        var item = cur._slots[i].Item;
                        if (item != null)
                        {
                            result = item;
                            return true;
                        }
                    }
                }
                cur = cur._nextSegment;
            }
            result = null;
            return false;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public void Enqueue(T item)
        {
            if (item == null) throw new ArgumentNullException(nameof(item));

            while (true)
            {
                var tail = _tailSegment;
                int slotIdx = Interlocked.Increment(ref tail._tail.Value);

                if (slotIdx < tail.Capacity)
                {
                    ref var slot = ref tail._slots[slotIdx];
                    slot.Item = item;
                    Volatile.Write(ref slot.Sequence, ReorderableSegment<T>.StateReady);

                    if (s_isIntrusive)
                    {
                        Unsafe.As<IHasSlotHandle<T>>(item).SlotHandle = new SlotHandle<T>(tail, slotIdx);
                    }
                    return;
                }

                // Grow segment
                var next = tail._nextSegment;
                if (next != null)
                {
                    _tailSegment = next;
                }
                else
                {
                    int nextCapacity = Math.Min(MaxSegmentSize, tail.Capacity * 2);
                    var newSeg = new ReorderableSegment<T>(
                        Interlocked.Increment(ref s_segmentIdCounter), nextCapacity);
                    if (Interlocked.CompareExchange(ref tail._nextSegment, newSeg, null) == null)
                    {
                        _tailSegment = newSeg;
                    }
                    else
                    {
                        _tailSegment = tail._nextSegment;
                    }
                }
            }
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool TryDequeue(out T? item)
        {
            var spinner = new SpinWait();

            while (true)
            {
                var headSeg = _headSegment;
                int headIdx = Volatile.Read(ref headSeg._head.Value);
                int tailIdx = Volatile.Read(ref headSeg._tail.Value);

                if (headIdx >= tailIdx)
                {
                    var next = headSeg._nextSegment;
                    if (next != null)
                    {
                        _headSegment = next;
                        continue;
                    }
                    item = null;
                    return false;
                }

                int slotIdx = Interlocked.Increment(ref headSeg._head.Value);

                if (slotIdx < headSeg.Capacity)
                {
                    if (slotIdx > tailIdx)
                    {
                        while (Volatile.Read(ref headSeg._tail.Value) < slotIdx)
                        {
                            if (headSeg._nextSegment != null && Volatile.Read(ref headSeg._tail.Value) < slotIdx)
                            {
                                // Producer has sealed this segment and moved to the next segment;
                                // no more items will ever be enqueued at or beyond slotIdx here.
                                var next = headSeg._nextSegment;
                                _headSegment = next;
                                break;
                            }
                            spinner.SpinOnce();
                        }

                        if (_headSegment != headSeg)
                        {
                            continue;
                        }
                    }

                    ref var slot = ref headSeg._slots[slotIdx];

                    // Direct CAS claim: fast path for ready slot
                    int seq = Interlocked.CompareExchange(
                        ref slot.Sequence,
                        ReorderableSegment<T>.StateClaimed,
                        ReorderableSegment<T>.StateReady);

                    if (seq == ReorderableSegment<T>.StateReady)
                    {
                        item = slot.Item;
                        slot.Item = null;

                        if (slotIdx == headSeg.Capacity - 1)
                        {
                            var next = headSeg._nextSegment;
                            if (next != null)
                            {
                                _headSegment = next;
                            }
                        }

                        return true;
                    }

                    // Slot was not yet ready (StateFree) or was being reordered (StateLockedReorder)
                    while (true)
                    {
                        int currentSeq = Volatile.Read(ref slot.Sequence);
                        if (currentSeq == ReorderableSegment<T>.StateClaimed)
                        {
                            // Already claimed by another operation or vacated
                            break;
                        }

                        if (currentSeq == ReorderableSegment<T>.StateReady)
                        {
                            if (Interlocked.CompareExchange(
                                ref slot.Sequence,
                                ReorderableSegment<T>.StateClaimed,
                                ReorderableSegment<T>.StateReady) == ReorderableSegment<T>.StateReady)
                            {
                                item = slot.Item;
                                slot.Item = null;

                                if (slotIdx == headSeg.Capacity - 1)
                                {
                                    var next = headSeg._nextSegment;
                                    if (next != null)
                                    {
                                        _headSegment = next;
                                    }
                                }

                                return true;
                            }
                        }

                        if (headSeg._nextSegment != null && currentSeq == ReorderableSegment<T>.StateFree)
                        {
                            // If segment is sealed and slot is still Free, producer never filled it
                            break;
                        }

                        spinner.SpinOnce();
                    }

                    continue;
                }
                else
                {
                    var next = headSeg._nextSegment;
                    if (next != null)
                    {
                        _headSegment = next;
                        continue;
                    }
                    item = null;
                    return false;
                }
            }
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool TryMoveBefore(T sourceItem, T targetDestination)
        {
            if (sourceItem == null || targetDestination == null || ReferenceEquals(sourceItem, targetDestination))
                return false;

            SlotHandle<T> srcHandle = default;
            SlotHandle<T> destHandle = default;

            if (s_isIntrusive)
            {
                srcHandle = Unsafe.As<IHasSlotHandle<T>>(sourceItem).SlotHandle;
                destHandle = Unsafe.As<IHasSlotHandle<T>>(targetDestination).SlotHandle;
            }
            else
            {
                // Find items in active segments
                var curSeg = _headSegment;
                while (curSeg != null && (srcHandle.IsNull || destHandle.IsNull))
                {
                    int tailLimit = Math.Min(curSeg.Capacity, Volatile.Read(ref curSeg._tail.Value) + 1);
                    for (int i = 0; i < tailLimit; i++)
                    {
                        ref var slot = ref curSeg._slots[i];
                        if (slot.Item != null && Volatile.Read(ref slot.Sequence) == ReorderableSegment<T>.StateReady)
                        {
                            if (srcHandle.IsNull && ReferenceEquals(slot.Item, sourceItem))
                            {
                                srcHandle = curSeg.GetHandle(i);
                            }
                            else if (destHandle.IsNull && ReferenceEquals(slot.Item, targetDestination))
                            {
                                destHandle = curSeg.GetHandle(i);
                            }
                        }
                    }
                    curSeg = curSeg._nextSegment;
                }
            }

            if (srcHandle.IsNull || destHandle.IsNull || srcHandle.Segment == null || destHandle.Segment == null)
                return false;

            long srcSeq = (srcHandle.Segment.Id << 32) | (uint)srcHandle.SlotIndex;
            long destSeq = (destHandle.Segment.Id << 32) | (uint)destHandle.SlotIndex;

            // If source is already scheduled to dequeue before destination, condition is satisfied
            if (srcSeq < destSeq)
                return true;

            ref var srcSlot = ref srcHandle.Segment._slots[srcHandle.SlotIndex];
            ref var destSlot = ref destHandle.Segment._slots[destHandle.SlotIndex];

            ref var firstSlot = ref (srcSeq < destSeq ? ref srcSlot : ref destSlot);
            ref var secondSlot = ref (srcSeq < destSeq ? ref destSlot : ref srcSlot);

            if (Interlocked.CompareExchange(ref firstSlot.Sequence, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
                return false;

            if (Interlocked.CompareExchange(ref secondSlot.Sequence, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
            {
                Volatile.Write(ref firstSlot.Sequence, ReorderableSegment<T>.StateReady);
                return false;
            }

            if (!ReferenceEquals(srcSlot.Item, sourceItem) || !ReferenceEquals(destSlot.Item, targetDestination))
            {
                Volatile.Write(ref secondSlot.Sequence, ReorderableSegment<T>.StateReady);
                Volatile.Write(ref firstSlot.Sequence, ReorderableSegment<T>.StateReady);
                return false;
            }

            // Swap items in slots
            srcSlot.Item = targetDestination;
            destSlot.Item = sourceItem;

            // Swap handles for intrusive items
            if (s_isIntrusive)
            {
                Unsafe.As<IHasSlotHandle<T>>(sourceItem).SlotHandle = destHandle;
                Unsafe.As<IHasSlotHandle<T>>(targetDestination).SlotHandle = srcHandle;
            }

            Volatile.Write(ref secondSlot.Sequence, ReorderableSegment<T>.StateReady);
            Volatile.Write(ref firstSlot.Sequence, ReorderableSegment<T>.StateReady);
            return true;
        }

        public IEnumerator<T> GetEnumerator()
        {
            var curSeg = _headSegment;
            while (curSeg != null)
            {
                int tailLimit = Math.Min(curSeg.Capacity, Volatile.Read(ref curSeg._tail.Value) + 1);
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

