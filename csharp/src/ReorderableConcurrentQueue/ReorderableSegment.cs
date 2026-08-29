using System;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading;

namespace ReorderableCollections
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct IndexSlot<T> where T : class
    {
        public T? Item;
        public int Sequence; // State: 0 = Free, 1 = Ready, 2 = LockedReorder, 3 = Claimed
    }

    internal sealed class ReorderableSegment<T> where T : class
    {
        internal const int StateFree = 0;
        internal const int StateReady = 1;
        internal const int StateLockedReorder = 2;
        internal const int StateClaimed = 3;

        internal readonly long Id;
        internal readonly IndexSlot<T>[] _slots;
        internal readonly int Capacity;
        internal volatile ReorderableSegment<T>? _nextSegment;

        internal int _tailIndex = -1;

        // Cache line padding (56 bytes) to isolate _tailIndex and _headIndex across cores
        private long _pad0, _pad1, _pad2, _pad3, _pad4, _pad5, _pad6;

        internal int _headIndex = -1;

        internal ReorderableSegment(long id, int capacity)
        {
            Id = id;
            Capacity = capacity;
            _slots = new IndexSlot<T>[capacity];
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal SlotHandle<T> GetHandle(int slotIdx)
        {
            return new SlotHandle<T>(this, slotIdx);
        }
    }
}

