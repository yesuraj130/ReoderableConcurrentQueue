using System.Collections.Concurrent;
using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using ReorderableCollections;

namespace Benchmarks
{
    [SimpleJob(RuntimeMoniker.Net60)]
    [SimpleJob(RuntimeMoniker.Net48)]
    [MemoryDiagnoser]
    public class QueueBenchmarks
    {
        private ConcurrentQueue<string> _stdQueue;
        private ReorderableConcurrentQueue<string> _reorderQueue;
        private string[] _testPayloads;

        [Params(1000, 10000)]
        public int OperationsCount;

        [GlobalSetup]
        public void Setup()
        {
            _testPayloads = new string[OperationsCount];
            for (int i = 0; i < OperationsCount; i++)
            {
                _testPayloads[i] = "Payload_" + i;
            }
        }

        [IterationSetup]
        public void IterationSetup()
        {
            _stdQueue = new ConcurrentQueue<string>();
            _reorderQueue = new ReorderableConcurrentQueue<string>();
        }

        [Benchmark(Baseline = true)]
        public void Standard_ConcurrentQueue_EnqueueDequeue()
        {
            for (int i = 0; i < OperationsCount; i++)
                _stdQueue.Enqueue(_testPayloads[i]);

            for (int i = 0; i < OperationsCount; i++)
                _stdQueue.TryDequeue(out _);
        }

        [Benchmark]
        public void Reorderable_EnqueueDequeue()
        {
            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.Enqueue(_testPayloads[i]);

            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.TryDequeue(out _);
        }

        [Benchmark]
        public void Reorderable_InFlight_Reorder()
        {
            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.Enqueue(_testPayloads[i]);

            // Reorder mid-queue element to front
            _reorderQueue.TryMoveBefore(_testPayloads[OperationsCount / 2], _testPayloads[0]);

            for (int i = 0; i < OperationsCount; i++)
                _reorderQueue.TryDequeue(out _);
        }
    }
}
