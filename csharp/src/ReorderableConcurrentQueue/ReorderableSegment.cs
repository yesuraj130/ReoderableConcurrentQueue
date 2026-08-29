using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace ReorderableCollections
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct IndexSlot<T> where T : class
    {
        public T? Item;
        public int Sequence; // State / sequence: 0 = Free, 1 = Ready, 2 = LockedReorder, 3 = Claimed
        public int NextSlot; // -1 = natural (i + 1), >= 0 = explicit slot
        public ReorderableSegment<T>? NextSegment;
        public int PrevSlot; // -1 = natural (i - 1), >= 0 = explicit slot
        public ReorderableSegment<T>? PrevSegment;
    }

    internal sealed class ReorderableSegment<T> where T : class
    {
        internal const int StateFree = 0;
        internal const int StateReady = 1;
        internal const int StateLockedReorder = 2;
        internal const int StateClaimed = 3;

        internal readonly long Id;
        internal readonly IndexSlot<T>[] _slots;
        internal readonly int _mask;
        internal volatile ReorderableSegment<T>? _nextSegment;
        internal volatile ReorderableSegment<T>? _prevSegment;

        internal volatile bool _hasReordered;
        internal int _tailIndex = -1;
        internal int _headIndex = -1;
        private int _activeSlots;

        private SlotHandle<T>?[]? _handles;

        internal ReorderableSegment(long id, int capacity)
        {
            Id = id;
            _slots = new IndexSlot<T>[capacity];
            _mask = capacity - 1;
        }

        internal int Capacity => _slots.Length;
        internal bool IsEmpty => Volatile.Read(ref _activeSlots) == 0;

        internal bool TryAllocateSlot(out int index)
        {
            int allocated = Interlocked.Increment(ref _tailIndex);
            if (allocated < Capacity)
            {
                index = allocated;
                Interlocked.Increment(ref _activeSlots);
                return true;
            }
            index = -1;
            return false;
        }

        internal SlotHandle<T> GetHandle(int slotIdx)
        {
            var handles = Volatile.Read(ref _handles);
            if (handles == null)
            {
                var newHandles = new SlotHandle<T>?[Capacity];
                Interlocked.CompareExchange(ref _handles, newHandles, null);
                handles = _handles!;
            }

            var h = handles[slotIdx];
            if (h == null)
            {
                h = new SlotHandle<T>(this, slotIdx);
                handles[slotIdx] = h;
            }
            return h;
        }

        internal void OnSlotFreed()
        {
            Interlocked.Decrement(ref _activeSlots);
        }
    }
}

