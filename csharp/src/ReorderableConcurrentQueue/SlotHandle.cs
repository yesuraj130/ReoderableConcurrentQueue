using System;
using System.Runtime.InteropServices;

namespace ReorderableCollections
{
    [StructLayout(LayoutKind.Sequential)]
    public struct SlotHandle<T> : IEquatable<SlotHandle<T>>
    {
        internal readonly ReorderableSegment<T> Segment;
        internal readonly int SlotIndex;

        internal SlotHandle(ReorderableSegment<T> segment, int slotIndex)
        {
            Segment = segment;
            SlotIndex = slotIndex;
        }

        public static SlotHandle<T> Null => new SlotHandle<T>(null, -1);
        public bool IsNull => Segment == null || SlotIndex < 0;

        public bool Equals(SlotHandle<T> other) =>
            ReferenceEquals(Segment, other.Segment) && SlotIndex == other.SlotIndex;

        public override bool Equals(object obj) =>
            obj is SlotHandle<T> other && Equals(other);

        public override int GetHashCode() =>
            (Segment != null ? Segment.Id.GetHashCode() : 0) ^ SlotIndex;
    }
}
