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

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    internal struct PaddedHeadIndex
    {
        [FieldOffset(0)] internal int Value;
    }

    [StructLayout(LayoutKind.Explicit, Size = 64)]
    internal struct PaddedTailIndex
    {
        [FieldOffset(0)] internal int Value;
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

        internal PaddedTailIndex _tail;
        internal PaddedHeadIndex _head;

        internal ReorderableSegment(long id, int capacity)
        {
            Id = id;
            Capacity = capacity;
            _slots = new IndexSlot<T>[capacity];
            _tail.Value = -1;
            _head.Value = -1;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal SlotHandle<T> GetHandle(int slotIdx)
        {
            return new SlotHandle<T>(this, slotIdx);
        }
    }
}

