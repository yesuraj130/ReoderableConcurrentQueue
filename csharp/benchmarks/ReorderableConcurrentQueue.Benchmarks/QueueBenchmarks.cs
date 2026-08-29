using System.Collections.Concurrent;
using BenchmarkDotNet.Attributes;
using ReorderableCollections;

namespace Benchmarks
{
    public sealed class QueueTaskItem : IHasSlotHandle<QueueTaskItem>
    {
        public int Id { get; }
        public SlotHandle<QueueTaskItem> SlotHandle { get; set; }

        public QueueTaskItem(int id)
        {
            Id = id;
        }
    }

    [MemoryDiagnoser]
    public class QueueBenchmarks
    {
        private ConcurrentQueue<QueueTaskItem> _stdQueue = default!;
        private ReorderableConcurrentQueue<QueueTaskItem> _reorderQueue = default!;
        private QueueTaskItem[] _testItems = default!;

        private ConcurrentQueue<string> _stdStringQueue = default!;
        private ReorderableConcurrentQueue<string> _reorderStringQueue = default!;
        private string[] _testStrings = default!;

        [Params(1000, 10000)]
        public int OperationsCount;

        [GlobalSetup]
        public void Setup()
        {
            _testItems = new QueueTaskItem[OperationsCount];
            _testStrings = new string[OperationsCount];
            for (int i = 0; i < OperationsCount; i++)
            {
                _testItems[i] = new QueueTaskItem(i);
                _testStrings[i] = "Payload_" + i;
            }
        }

        [IterationSetup]
        public void IterationSetup()
        {
            _stdQueue = new ConcurrentQueue<QueueTaskItem>();
            _reorderQueue = new ReorderableConcurrentQueue<QueueTaskItem>();

            _stdStringQueue = new ConcurrentQueue<string>();
            _reorderStringQueue = new ReorderableConcurrentQueue<string>();
        }

        // --- Intrusive Object Benchmarks (Zero-Alloc / Direct Handle Access) ---

        [Benchmark(Baseline = true)]
        public void Standard_IntrusiveItem_EnqueueDequeue()
        {
            for (int i = 0; i < OperationsCount; i++)
                _stdQueue.Enqueue(_testItems[i]);

            for (int i = 0; i < OperationsCount; i++)
                _stdQueue.TryDequeue(out _);
        }

        [Benchmark]
        public void Reorderable_IntrusiveItem_EnqueueDequeue()
        {
            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.Enqueue(_testItems[i]);

            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.TryDequeue(out _);
        }

        [Benchmark]
        public void Reorderable_IntrusiveItem_InFlight_Reorder()
        {
            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.Enqueue(_testItems[i]);

            // Reorder mid-queue element to front using intrusive SlotHandle
            _reorderQueue.TryMoveBefore(_testItems[OperationsCount / 2], _testItems[0]);

            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.TryDequeue(out _);
        }

        // --- Non-Intrusive Sealed String Benchmarks (Directory Fallback) ---

        [Benchmark]
        public void Standard_String_EnqueueDequeue()
        {
            for (int i = 0; i < OperationsCount; i++)
                _stdStringQueue.Enqueue(_testStrings[i]);

            for (int i = 0; i < OperationsCount; i++)
                _stdStringQueue.TryDequeue(out _);
        }

        [Benchmark]
        public void Reorderable_String_EnqueueDequeue()
        {
            for (int i = 0; i < OperationsCount; i++)
                _reorderStringQueue.Enqueue(_testStrings[i]);

            for (int i = 0; i < OperationsCount; i++)
                _reorderStringQueue.TryDequeue(out _);
        }
    }
}

