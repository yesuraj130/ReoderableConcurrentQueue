using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace ReorderableCollections
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct IndexSlot<T>
    {
        public T Item;
        public SlotHandle<T> Next;
        public SlotHandle<T> Prev;
        public int State; // 0 = Free, 1 = Ready, 2 = LockedReorder, 3 = Claimed
    }

    internal sealed class ReorderableSegment<T>
    {
        internal const int StateFree = 0;
        internal const int StateReady = 1;
        internal const int StateLockedReorder = 2;
        internal const int StateClaimed = 3;

        internal readonly long Id;
        internal readonly IndexSlot<T>[] _slots;
        internal readonly int _mask;
        internal volatile ReorderableSegment<T> _nextSegment;

        private int _activeSlots;
        private int _tailIndex = -1;

        internal ReorderableSegment<T>(long id, int capacity)
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

        internal void OnSlotFreed()
        {
            Interlocked.Decrement(ref _activeSlots);
        }
    }
}
