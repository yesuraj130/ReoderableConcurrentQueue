using System;

namespace ReorderableCollections
{
    public sealed class SlotHandle<T> : IEquatable<SlotHandle<T>> where T : class
    {
        internal readonly ReorderableSegment<T> Segment;
        internal readonly int SlotIndex;

        internal SlotHandle(ReorderableSegment<T> segment, int slotIndex)
        {
            Segment = segment;
            SlotIndex = slotIndex;
        }

        public static SlotHandle<T> Null => null;
        public bool IsNull => Segment == null || SlotIndex < 0;

        public bool Equals(SlotHandle<T> other)
        {
            if (ReferenceEquals(other, null)) return false;
            return ReferenceEquals(Segment, other.Segment) && SlotIndex == other.SlotIndex;
        }

        public override bool Equals(object obj) =>
            obj is SlotHandle<T> other && Equals(other);

        public override int GetHashCode() =>
            (Segment != null ? Segment.Id.GetHashCode() : 0) ^ SlotIndex;
    }
}

