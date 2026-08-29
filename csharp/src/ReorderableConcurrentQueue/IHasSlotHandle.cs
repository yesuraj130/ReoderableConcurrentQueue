namespace ReorderableCollections
{
    public interface IHasSlotHandle<T> where T : class
    {
        SlotHandle<T> SlotHandle { get; set; }
    }
}
