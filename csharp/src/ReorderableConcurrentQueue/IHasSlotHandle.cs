namespace ReorderableCollections
{
    public interface IHasSlotHandle<T>
    {
        SlotHandle<T> SlotHandle { get; set; }
    }
}
