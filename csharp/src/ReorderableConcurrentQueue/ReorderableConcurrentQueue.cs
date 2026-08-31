using System;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;

namespace ReorderableCollections
{
    internal static class IntrusiveHelper<T> where T : class
    {
        public static readonly bool IsIntrusive = typeof(IHasSlotHandle<T>).IsAssignableFrom(typeof(T));
    }

    /// <summary>
    /// A high-performance lock-free concurrent queue supporting out-of-order priority adjustment
    /// via <see cref="TryMoveBefore(T, T)"/>.
    /// </summary>
    public class ReorderableConcurrentQueue<T> where T : class
    {
        private const int InitialSegmentSize = 32;
        private const int MaxSegmentSize = 1024;
        private static long s_segmentIdCounter;
        private static readonly bool s_isIntrusive = IntrusiveHelper<T>.IsIntrusive;

        private volatile ReorderableSegment<T> _headSegment;
        private volatile ReorderableSegment<T> _tailSegment;
        private int _count;

        public ReorderableConcurrentQueue()
        {
            var initial = new ReorderableSegment<T>(Interlocked.Increment(ref s_segmentIdCounter), InitialSegmentSize);
            _headSegment = initial;
            _tailSegment = initial;
            _count = 0;
        }

        /// <summary>
        /// Gets the current number of elements contained in the queue.
        /// </summary>
        public int Count => Math.Max(0, Volatile.Read(ref _count));

        /// <summary>
        /// Gets a value indicating whether the queue is empty.
        /// </summary>
        public bool IsEmpty => Volatile.Read(ref _count) <= 0;

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
                        Debug.Assert(item is IHasSlotHandle<T>);
                        Unsafe.As<IHasSlotHandle<T>>(item).SlotHandle = new SlotHandle<T>(tail, slotIdx);
                    }

                    Interlocked.Increment(ref _count);
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

                        if (s_isIntrusive && item != null)
                        {
                            Debug.Assert(item is IHasSlotHandle<T>);
                            Unsafe.As<IHasSlotHandle<T>>(item).SlotHandle = SlotHandle<T>.Null;
                        }

                        Interlocked.Decrement(ref _count);

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

                                if (s_isIntrusive && item != null)
                                {
                                    Debug.Assert(item is IHasSlotHandle<T>);
                                    Unsafe.As<IHasSlotHandle<T>>(item).SlotHandle = SlotHandle<T>.Null;
                                }

                                Interlocked.Decrement(ref _count);

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

        /// <summary>
        /// Moves <paramref name="sourceItem"/> before <paramref name="targetDestination"/> in the queue's
        /// dequeue order. Elements between target and source are shifted back by one position.
        /// </summary>
        /// <param name="sourceItem">The item to move forward.</param>
        /// <param name="targetDestination">The target item before which <paramref name="sourceItem"/> should be placed.</param>
        /// <returns>True if the item was successfully moved; false if items were not found or already dequeued.</returns>
        public bool TryMoveBefore(T sourceItem, T targetDestination)
        {
            if (sourceItem == null || targetDestination == null || ReferenceEquals(sourceItem, targetDestination))
                return false;

            SlotHandle<T> srcHandle = default;
            SlotHandle<T> destHandle = default;

            if (s_isIntrusive)
            {
                Debug.Assert(sourceItem is IHasSlotHandle<T>);
                Debug.Assert(targetDestination is IHasSlotHandle<T>);
                srcHandle = Unsafe.As<IHasSlotHandle<T>>(sourceItem).SlotHandle;
                destHandle = Unsafe.As<IHasSlotHandle<T>>(targetDestination).SlotHandle;
            }
            else
            {
                // Scan active segments to find slot handles for source and destination
                var curSeg = _headSegment;
                while (curSeg != null && (srcHandle.IsNull || destHandle.IsNull))
                {
                    int tailLimit = Math.Min(curSeg.Capacity, Volatile.Read(ref curSeg._tail.Value) + 1);
                    for (int i = 0; i < tailLimit; i++)
                    {
                        ref var slot = ref curSeg._slots[i];
                        if (Volatile.Read(ref slot.Sequence) == ReorderableSegment<T>.StateReady)
                        {
                            var item = slot.Item;
                            if (item != null)
                            {
                                if (srcHandle.IsNull && ReferenceEquals(item, sourceItem))
                                {
                                    srcHandle = curSeg.GetHandle(i);
                                }
                                else if (destHandle.IsNull && ReferenceEquals(item, targetDestination))
                                {
                                    destHandle = curSeg.GetHandle(i);
                                }
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

            // If source is already ahead of target, verify it is still in the queue
            if (srcSeq < destSeq)
            {
                ref var sSlot = ref srcHandle.Segment._slots[srcHandle.SlotIndex];
                ref var dSlot = ref destHandle.Segment._slots[destHandle.SlotIndex];
                if (Volatile.Read(ref sSlot.Sequence) == ReorderableSegment<T>.StateReady &&
                    Volatile.Read(ref dSlot.Sequence) == ReorderableSegment<T>.StateReady &&
                    ReferenceEquals(sSlot.Item, sourceItem) &&
                    ReferenceEquals(dSlot.Item, targetDestination))
                {
                    return true;
                }
                return false;
            }

            // True MoveBefore: source is located behind target (destSeq < srcSeq).
            // We collect all slots from destHandle to srcHandle and lock them in ascending sequence order.
            var slotsToLock = new System.Collections.Generic.List<SlotHandle<T>>();
            var seg = destHandle.Segment;
            int currentSlot = destHandle.SlotIndex;

            while (seg != null)
            {
                int endSlot = (seg == srcHandle.Segment) ? srcHandle.SlotIndex : seg.Capacity - 1;
                for (int s = currentSlot; s <= endSlot; s++)
                {
                    slotsToLock.Add(new SlotHandle<T>(seg, s));
                }

                if (seg == srcHandle.Segment)
                    break;

                seg = seg._nextSegment;
                currentSlot = 0;
            }

            if (slotsToLock.Count < 2)
                return false;

            int lockedCount = 0;
            try
            {
                // Lock all slots from dest to src in ascending order
                for (int i = 0; i < slotsToLock.Count; i++)
                {
                    var handle = slotsToLock[i];
                    ref var slot = ref handle.Segment._slots[handle.SlotIndex];

                    if (Interlocked.CompareExchange(
                            ref slot.Sequence,
                            ReorderableSegment<T>.StateLockedReorder,
                            ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
                    {
                        return false;
                    }
                    lockedCount++;
                }

                // Verify endpoints match expected items
                var firstHandle = slotsToLock[0];
                var lastHandle = slotsToLock[slotsToLock.Count - 1];

                ref var firstSlot = ref firstHandle.Segment._slots[firstHandle.SlotIndex];
                ref var lastSlot = ref lastHandle.Segment._slots[lastHandle.SlotIndex];

                if (!ReferenceEquals(firstSlot.Item, targetDestination) || !ReferenceEquals(lastSlot.Item, sourceItem))
                {
                    return false;
                }

                // Verify all intermediate items are present
                for (int i = 0; i < slotsToLock.Count; i++)
                {
                    var h = slotsToLock[i];
                    if (h.Segment._slots[h.SlotIndex].Item == null)
                    {
                        return false;
                    }
                }

                // Perform Shift Insertion:
                // Move sourceItem into firstSlot (dest), and shift previous items forward by 1 slot
                T movingItem = lastSlot.Item!;
                for (int i = slotsToLock.Count - 1; i > 0; i--)
                {
                    var currH = slotsToLock[i];
                    var prevH = slotsToLock[i - 1];

                    var itemToShift = prevH.Segment._slots[prevH.SlotIndex].Item!;
                    currH.Segment._slots[currH.SlotIndex].Item = itemToShift;

                    if (s_isIntrusive)
                    {
                        Unsafe.As<IHasSlotHandle<T>>(itemToShift).SlotHandle = currH;
                    }
                }

                firstSlot.Item = movingItem;
                if (s_isIntrusive)
                {
                    Unsafe.As<IHasSlotHandle<T>>(movingItem).SlotHandle = firstHandle;
                }

                return true;
            }
            finally
            {
                // Unlock all successfully locked slots in reverse order
                for (int i = lockedCount - 1; i >= 0; i--)
                {
                    var handle = slotsToLock[i];
                    Volatile.Write(ref handle.Segment._slots[handle.SlotIndex].Sequence, ReorderableSegment<T>.StateReady);
                }
            }
        }
    }
}


