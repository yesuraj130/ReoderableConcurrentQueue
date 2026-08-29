using System;
using System.Runtime.CompilerServices;

namespace ReorderableCollections
{
    public readonly struct SlotHandle<T> : IEquatable<SlotHandle<T>> where T : class
    {
        internal readonly ReorderableSegment<T> Segment;
        internal readonly int SlotIndex;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        internal SlotHandle(ReorderableSegment<T> segment, int slotIndex)
        {
            Segment = segment;
            SlotIndex = slotIndex;
        }

        public static SlotHandle<T> Null => default;
        public bool IsNull => Segment == null;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public bool Equals(SlotHandle<T> other)
        {
            return ReferenceEquals(Segment, other.Segment) && SlotIndex == other.SlotIndex;
        }

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public override bool Equals(object? obj) =>
            obj is SlotHandle<T> other && Equals(other);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public override int GetHashCode() =>
            (Segment != null ? Segment.Id.GetHashCode() : 0) ^ SlotIndex;

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static bool operator ==(SlotHandle<T> left, SlotHandle<T> right) => left.Equals(right);

        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        public static bool operator !=(SlotHandle<T> left, SlotHandle<T> right) => !left.Equals(right);
    }
}

