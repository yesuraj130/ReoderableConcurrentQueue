using System;

namespace ReorderableCollections
{
    public readonly struct SlotHandle<T> : IEquatable<SlotHandle<T>> where T : class
    {
        internal readonly ReorderableSegment<T> Segment;
        internal readonly int SlotIndex;

        internal SlotHandle(ReorderableSegment<T> segment, int slotIndex)
        {
            Segment = segment;
            SlotIndex = slotIndex;
        }

        public static SlotHandle<T> Null => default;
        public bool IsNull => Segment == null;

        public bool Equals(SlotHandle<T> other)
        {
            return ReferenceEquals(Segment, other.Segment) && SlotIndex == other.SlotIndex;
        }

        public override bool Equals(object? obj) =>
            obj is SlotHandle<T> other && Equals(other);

        public override int GetHashCode() =>
            (Segment != null ? Segment.Id.GetHashCode() : 0) ^ SlotIndex;

        public static bool operator ==(SlotHandle<T> left, SlotHandle<T> right) => left.Equals(right);
        public static bool operator !=(SlotHandle<T> left, SlotHandle<T> right) => !left.Equals(right);
    }
}

