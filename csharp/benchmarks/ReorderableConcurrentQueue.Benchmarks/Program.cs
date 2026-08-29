using BenchmarkDotNet.Running;
using Benchmarks;

namespace ReorderableCollections.Benchmarks
{
    public class Program
    {
        public static void Main(string[] args)
        {
            var summary = BenchmarkRunner.Run<QueueBenchmarks>();
        }
    }
}
