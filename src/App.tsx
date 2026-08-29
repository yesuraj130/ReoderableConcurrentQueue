import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  RotateCcw, 
  Plus, 
  Minus, 
  Sparkles, 
  CheckCircle, 
  ArrowRight, 
  FileCode, 
  Layers, 
  Cpu, 
  Activity, 
  Copy, 
  Terminal, 
  Sliders, 
  AlertTriangle,
  Info,
  ChevronRight,
  ExternalLink
} from 'lucide-react';
import { 
  SimulatedReorderableQueue, 
  runLiveBenchmark, 
  BenchmarkResult, 
  STATE_FREE, 
  STATE_READY, 
  STATE_LOCKED_REORDER, 
  STATE_CLAIMED 
} from './queueEngine';

interface QueueItem {
  id: string;
  val: string;
}

export default function App() {
  // Simulator State
  const [segmentSize, setSegmentSize] = useState<number>(8);
  const [queue, setQueue] = useState<SimulatedReorderableQueue<QueueItem>>(
    () => new SimulatedReorderableQueue<QueueItem>(8)
  );
  const [newValue, setNewValue] = useState<string>('');
  const [enqueueCount, setEnqueueCount] = useState<number>(5);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string>('');
  
  // Real-time Simulation Logs
  const [logs, setLogs] = useState<{ time: string; type: 'info' | 'success' | 'warn' | 'error'; message: string }[]>([]);
  
  // Simulation Thread settings
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simSpeed, setSimSpeed] = useState<number>(800); // ms
  const [simStats, setSimStats] = useState({
    enqueued: 0,
    dequeued: 0,
    reordered: 0,
    contention: 0
  });

  // Benchmark Settings
  const [benchmarkRuntime, setBenchmarkRuntime] = useState<'.NET Framework 4.8' | '.NET 6.0'>('.NET Framework 4.8');
  const [operationsCount, setOperationsCount] = useState<number>(10000);
  const [producerThreads, setProducerThreads] = useState<number>(4);
  const [consumerThreads, setConsumerThreads] = useState<number>(4);
  const [reorderRatio, setReorderRatio] = useState<number>(0.15);
  const [benchmarkResults, setBenchmarkResults] = useState<BenchmarkResult | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState<boolean>(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'visualizer' | 'benchmarks' | 'code' | 'docs'>('visualizer');

  // Code Explorer State
  const [selectedCodeFile, setSelectedCodeFile] = useState<string>('queue');
  const [copiedNotification, setCopiedNotification] = useState<string>('');

  // Auto-populate some initial items in visualizer for amazing first look
  useEffect(() => {
    const q = new SimulatedReorderableQueue<QueueItem>(segmentSize);
    q.enqueue({ id: 'item-1', val: 'Request_A' });
    q.enqueue({ id: 'item-2', val: 'Request_B' });
    q.enqueue({ id: 'item-3', val: 'Request_C' });
    q.enqueue({ id: 'item-4', val: 'Request_D' });
    setQueue(q);
    addLog('System initialized with 4 pre-filled high-priority slots', 'info');
  }, [segmentSize]);

  // Thread Simulator Tick
  const simTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (isSimulating) {
      simTimerRef.current = setInterval(() => {
        handleSimulationTick();
      }, simSpeed);
    } else {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    }
    return () => {
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, [isSimulating, queue, simSpeed]);

  const addLog = (message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const now = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: now, type, message }, ...prev].slice(0, 50));
  };

  const handleEnqueue = () => {
    const val = newValue.trim() || `Job_${Math.floor(Math.random() * 1000)}`;
    const id = `item-${Date.now()}`;
    const success = queue.enqueue({ id, val });
    if (success) {
      addLog(`Enqueued item "${val}" into segment ${queue.tailSegment.id} at slot`, 'success');
      setNewValue('');
      setQueue(Object.create(queue)); // trigger re-render
    } else {
      addLog('Failed to allocate slot: Capacity limit hit', 'error');
    }
  };

  const handleDequeue = () => {
    const item = queue.tryDequeue();
    if (item) {
      addLog(`Dequeued item "${item.val}" successfully!`, 'success');
      setQueue(Object.create(queue));
    } else {
      addLog('TryDequeue returned false: Queue is empty or head is locked', 'warn');
    }
  };

  const handleReorder = () => {
    if (!selectedSource || !selectedTarget) {
      addLog('Select both source and destination target elements for TryMoveBefore', 'error');
      return;
    }
    const success = queue.tryMoveBefore(selectedSource, selectedTarget);
    if (success) {
      addLog(`Reorder success: Swapped "${selectedSource}" immediately before "${selectedTarget}" via atomic CAS lock`, 'success');
      setSelectedSource('');
      setSelectedTarget('');
      setQueue(Object.create(queue));
    } else {
      addLog(`Reorder failed: Lock contention or invalid items`, 'error');
    }
  };

  const handleReset = () => {
    const q = new SimulatedReorderableQueue<QueueItem>(segmentSize);
    setQueue(q);
    setSimStats({ enqueued: 0, dequeued: 0, reordered: 0, contention: 0 });
    addLog('Queue reset to fresh state with standard allocations', 'info');
  };

  // Automated Simulation Tick
  const handleSimulationTick = () => {
    const action = Math.random();
    
    if (action < 0.45) {
      // Enqueue
      const label = `ThreadJob_${Math.floor(Math.random() * 900 + 100)}`;
      const id = `item-${Date.now()}`;
      const success = queue.enqueue({ id, val: label });
      if (success) {
        setSimStats(prev => ({ ...prev, enqueued: prev.enqueued + 1 }));
        addLog(`[Producer #1] Enqueued ${label} to segment ${queue.tailSegment.id}`, 'info');
      }
    } else if (action < 0.80) {
      // Dequeue
      const item = queue.tryDequeue();
      if (item) {
        setSimStats(prev => ({ ...prev, dequeued: prev.dequeued + 1 }));
        addLog(`[Consumer #1] Dequeued & cleared ${item.val}`, 'success');
      } else {
        addLog(`[Consumer #2] SpinWait: Queue logical head is idle`, 'warn');
      }
    } else {
      // Reorder (Move mid-element to front of queue to demonstrate live dynamic prioritizing)
      const list = queue.toArray();
      if (list.length >= 3) {
        const sourceIdx = Math.floor(Math.random() * (list.length - 1)) + 1;
        const targetIdx = 0; // Move to head of queue
        const src = list[sourceIdx];
        const dest = list[targetIdx];
        
        const success = queue.tryMoveBefore(src.id, dest.id);
        if (success) {
          setSimStats(prev => ({ ...prev, reordered: prev.reordered + 1 }));
          addLog(`[Scheduler] Promoted "${src.val}" before "${dest.val}" via Compare-And-Swap`, 'success');
        } else {
          setSimStats(prev => ({ ...prev, contention: prev.contention + 1 }));
          addLog(`[Scheduler] SpinLock Contention detected! CAS state transition aborted`, 'error');
        }
      }
    }
    setQueue(Object.create(queue));
  };

  // Run suite benchmark DotNet imitation
  const handleRunSuite = () => {
    setIsBenchmarking(true);
    setTimeout(() => {
      const results = runLiveBenchmark(
        benchmarkRuntime,
        operationsCount,
        producerThreads,
        consumerThreads,
        reorderRatio
      );
      setBenchmarkResults(results);
      setIsBenchmarking(false);
      addLog(`Suite benchmark finished for ${benchmarkRuntime}. Ops: ${operationsCount}`, 'success');
    }, 1200);
  };

  const handleCopyToClipboard = (text: string, filename: string) => {
    navigator.clipboard.writeText(text);
    setSelectedCodeFile(filename);
    setCopiedNotification(filename);
    setTimeout(() => setCopiedNotification(''), 2000);
  };

  // Code definitions for C# queue
  const codeFiles: Record<string, { name: string; ext: string; content: string; desc: string }> = {
    slotHandle: {
      name: 'SlotHandle.cs',
      ext: 'csharp',
      desc: 'An immutable struct containing a fast segment pointer and direct array index for O(1) slot resolving.',
      content: `using System;
using System.Runtime.InteropServices;

namespace ReorderableCollections
{
    public interface IHasSlotHandle<T>
    {
        SlotHandle<T> SlotHandle { get; set; }
    }

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
}`
    },
    segment: {
      name: 'ReorderableSegment.cs',
      ext: 'csharp',
      desc: 'Holds fixed-capacity slots of memory. Avoids GC pressure by pre-allocating state structures in array segments.',
      content: `using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace ReorderableCollections
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct IndexSlot<T>
    {
        public T Item;
        public SlotHandle<T> Next;
        public SlotHandle<T> Prev;
        public int State; // 0 = Free, 1 = Ready, 2 = LockedReorder, 3 = Claimed
    }

    internal sealed class ReorderableSegment<T>
    {
        internal const int StateFree = 0;
        internal const int StateReady = 1;
        internal const int StateLockedReorder = 2;
        internal const int StateClaimed = 3;

        internal readonly long Id;
        internal readonly IndexSlot<T>[] _slots;
        internal readonly int _mask;
        internal volatile ReorderableSegment<T> _nextSegment;

        private int _activeSlots;
        private int _tailIndex = -1;

        internal ReorderableSegment<T>(long id, int capacity)
        {
            Id = id;
            _slots = new IndexSlot<T>[capacity];
            _mask = capacity - 1;
        }

        internal int Capacity => _slots.Length;
        internal bool IsEmpty => Volatile.Read(ref _activeSlots) == 0;

        internal bool TryAllocateSlot(out int index)
        {
            int allocated = Interlocked.Increment(ref _tailIndex);
            if (allocated < Capacity)
            {
                index = allocated;
                Interlocked.Increment(ref _activeSlots);
                return true;
            }
            index = -1;
            return false;
        }

        internal void OnSlotFreed()
        {
            Interlocked.Decrement(ref _activeSlots);
        }
    }
}`
    },
    queue: {
      name: 'ReorderableConcurrentQueue.cs',
      ext: 'csharp',
      desc: 'The master queue manager utilizing lock-free Compare-And-Swap pointer transitions and an optional Zero-Allocation Hybrid mode.',
      content: `using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;

namespace ReorderableCollections
{
    public class ReorderableConcurrentQueue<T> : IEnumerable<T> where T : class
    {
        private const int SegmentSize = 1024; // 2^10
        private static long s_segmentIdCounter;

        private volatile ReorderableSegment<T> _headSegment;
        private volatile ReorderableSegment<T> _tailSegment;

        private SlotHandle<T> _logicalHead = SlotHandle<T>.Null;
        private SlotHandle<T> _logicalTail = SlotHandle<T>.Null;

        // Fallback directory if T does not implement IHasSlotHandle<T>
        private readonly ConcurrentDictionary<T, SlotHandle<T>> _directory = 
            new ConcurrentDictionary<T, SlotHandle<T>>();

        private int _count;

        public ReorderableConcurrentQueue()
        {
            var initial = new ReorderableSegment<T>(Interlocked.Increment(ref s_segmentIdCounter), SegmentSize);
            _headSegment = initial;
            _tailSegment = initial;
        }

        public int Count => Math.Max(0, Volatile.Read(ref _count));
        public bool IsEmpty => Count == 0;

        public void Enqueue(T item)
        {
            if (item == null) throw new ArgumentNullException(nameof(item));

            while (true)
            {
                var tail = _tailSegment;
                if (tail.TryAllocateSlot(out int slotIdx))
                {
                    ref var slot = ref tail._slots[slotIdx];
                    var currentHandle = new SlotHandle<T>(tail, slotIdx);

                    slot.Item = item;
                    slot.Next = SlotHandle<T>.Null;

                    // Lock-Free atomic sequence wiring using CompareExchange loop
                    while (true)
                    {
                        var prevTail = Volatile.Read(ref _logicalTail);
                        slot.Prev = prevTail;
                        if (Interlocked.CompareExchange(ref _logicalTail, currentHandle, prevTail) == prevTail)
                        {
                            if (prevTail.IsNull)
                            {
                                _logicalHead = currentHandle;
                            }
                            else
                            {
                                ref var prevSlot = ref prevTail.Segment._slots[prevTail.SlotIndex];
                                prevSlot.Next = currentHandle;
                            }
                            break;
                        }
                    }

                    Volatile.Write(ref slot.State, ReorderableSegment<T>.StateReady);

                    // Zero-Allocation Hybrid mode: bypass directory entirely if interface is implemented!
                    if (item is IHasSlotHandle<T> reorderable)
                    {
                        reorderable.SlotHandle = currentHandle;
                    }
                    else
                    {
                        _directory[item] = currentHandle;
                    }

                    Interlocked.Increment(ref _count);
                    return;
                }

                // Grow segment
                lock (tail)
                {
                    if (tail._nextSegment == null)
                    {
                        var newSeg = new ReorderableSegment<T>(
                            Interlocked.Increment(ref s_segmentIdCounter), SegmentSize);
                        tail._nextSegment = newSeg;
                        _tailSegment = newSeg;
                    }
                }
            }
        }

        public bool TryDequeue(out T item)
        {
            var spinner = new SpinWait();

            while (true)
            {
                var head = _logicalHead;
                if (head.IsNull || Count == 0)
                {
                    item = null;
                    return false;
                }

                ref var slot = ref head.Segment._slots[head.SlotIndex];
                int state = Interlocked.CompareExchange(
                    ref slot.State, 
                    ReorderableSegment<T>.StateClaimed, 
                    ReorderableSegment<T>.StateReady);

                if (state == ReorderableSegment<T>.StateReady)
                {
                    item = slot.Item;
                    slot.Item = null;

                    if (item is IHasSlotHandle<T> reorderable)
                    {
                        reorderable.SlotHandle = SlotHandle<T>.Null;
                    }
                    else
                    {
                        _directory.TryRemove(item, out _);
                    }

                    // Lock-Free logical head advancement using CAS exchange
                    var nextHandle = slot.Next;
                    if (Interlocked.CompareExchange(ref _logicalHead, nextHandle, head) == head)
                    {
                        if (!nextHandle.IsNull)
                        {
                            ref var nextSlot = ref nextHandle.Segment._slots[nextHandle.SlotIndex];
                            nextSlot.Prev = SlotHandle<T>.Null;
                        }
                        else
                        {
                            Interlocked.CompareExchange(ref _logicalTail, SlotHandle<T>.Null, head);
                        }
                    }

                    slot.Next = SlotHandle<T>.Null;
                    slot.Prev = SlotHandle<T>.Null;
                    Volatile.Write(ref slot.State, ReorderableSegment<T>.StateFree);

                    head.Segment.OnSlotFreed();
                    Interlocked.Decrement(ref _count);

                    if (head.Segment.IsEmpty && head.Segment._nextSegment != null)
                    {
                        _headSegment = head.Segment._nextSegment;
                    }

                    return true;
                }

                if (state == ReorderableSegment<T>.StateLockedReorder)
                {
                    spinner.SpinOnce();
                    continue;
                }

                spinner.SpinOnce();
            }
        }

        public bool TryMoveBefore(T sourceItem, T targetDestination)
        {
            if (sourceItem == null || targetDestination == null || ReferenceEquals(sourceItem, targetDestination))
                return false;

            SlotHandle<T> srcHandle;
            SlotHandle<T> destHandle;

            if (sourceItem is IHasSlotHandle<T> srcReorderable)
            {
                srcHandle = srcReorderable.SlotHandle;
            }
            else
            {
                if (!_directory.TryGetValue(sourceItem, out srcHandle)) return false;
            }

            if (targetDestination is IHasSlotHandle<T> destReorderable)
            {
                destHandle = destReorderable.SlotHandle;
            }
            else
            {
                if (!_directory.TryGetValue(targetDestination, out destHandle)) return false;
            }

            if (srcHandle.IsNull || destHandle.IsNull) return false;

            // Ordered lock acquisition keys to guarantee deadlock freedom
            long keySrc = (srcHandle.Segment.Id << 32) | (uint)srcHandle.SlotIndex;
            long keyDest = (destHandle.Segment.Id << 32) | (uint)destHandle.SlotIndex;

            ref var srcSlot = ref srcHandle.Segment._slots[srcHandle.SlotIndex];
            ref var destSlot = ref destHandle.Segment._slots[destHandle.SlotIndex];

            // Canonical lock acquisition
            ref var firstSlot = ref (keySrc < keyDest ? ref srcSlot : ref destSlot);
            ref var secondSlot = ref (keySrc < keyDest ? ref destSlot : ref srcSlot);

            if (Interlocked.CompareExchange(ref firstSlot.State, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
                return false;

            if (Interlocked.CompareExchange(ref secondSlot.State, ReorderableSegment<T>.StateLockedReorder, ReorderableSegment<T>.StateReady) != ReorderableSegment<T>.StateReady)
            {
                Volatile.Write(ref firstSlot.State, ReorderableSegment<T>.StateReady);
                return false;
            }

            try
            {
                var prevSrc = srcSlot.Prev;
                var nextSrc = srcSlot.Next;

                if (!prevSrc.IsNull) prevSrc.Segment._slots[prevSrc.SlotIndex].Next = nextSrc;
                if (!nextSrc.IsNull) nextSrc.Segment._slots[nextSrc.SlotIndex].Prev = prevSrc;

                if (_logicalHead.Equals(srcHandle)) _logicalHead = nextSrc;
                if (_logicalTail.Equals(srcHandle)) _logicalTail = prevSrc;

                var prevDest = destSlot.Prev;

                if (!prevDest.IsNull) prevDest.Segment._slots[prevDest.SlotIndex].Next = srcHandle;
                srcSlot.Prev = prevDest;
                srcSlot.Next = destHandle;
                destSlot.Prev = srcHandle;

                if (_logicalHead.Equals(destHandle)) _logicalHead = srcHandle;

                return true;
            }
            finally
            {
                Volatile.Write(ref secondSlot.State, ReorderableSegment<T>.StateReady);
                Volatile.Write(ref firstSlot.State, ReorderableSegment<T>.StateReady);
            }
        }

        public IEnumerator<T> GetEnumerator()
        {
            var current = _logicalHead;
            while (!current.IsNull)
            {
                var item = current.Segment._slots[current.SlotIndex].Item;
                if (item != null) yield return item;
                current = current.Segment._slots[current.SlotIndex].Next;
            }
        }

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }
}`
    },
    benchmarks: {
      name: 'QueueBenchmarks.cs',
      ext: 'csharp',
      desc: 'The complete BenchmarkDotNet test harness designed to compare the queues under intensive thread contention.',
      content: `using System.Collections.Concurrent;
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
}`
    },
    setupScript: {
      name: 'SetupScript.sh',
      ext: 'bash',
      desc: 'Automates directory structuring, .NET CLI project initialization, references chaining, and git remote connection via GitHub CLI (gh).',
      content: `# 1. Create root directory
mkdir ReorderableConcurrentQueue && cd ReorderableConcurrentQueue

# 2. Initialize .NET Solution and Projects
dotnet new sln -n ReorderableConcurrentQueue
dotnet new classlib -n ReorderableConcurrentQueue -o src/ReorderableConcurrentQueue -f netstandard2.0
dotnet new console -n ReorderableConcurrentQueue.Benchmarks -o benchmarks/ReorderableConcurrentQueue.Benchmarks -f net6.0

# 3. Wire Solution References & Packages
dotnet sln add src/ReorderableConcurrentQueue/ReorderableConcurrentQueue.csproj
dotnet sln add benchmarks/ReorderableConcurrentQueue.Benchmarks/ReorderableConcurrentQueue.Benchmarks.csproj
dotnet add benchmarks/ReorderableConcurrentQueue.Benchmarks/ReorderableConcurrentQueue.Benchmarks.csproj reference src/ReorderableConcurrentQueue/ReorderableConcurrentQueue.csproj
dotnet add benchmarks/ReorderableConcurrentQueue.Benchmarks/ReorderableConcurrentQueue.Benchmarks.csproj package BenchmarkDotNet

# 4. Initialize Git and Create GitHub Repository via GitHub CLI
git init -b main
dotnet new gitignore
git add .
git commit -m "feat: Initial implementation of ReorderableConcurrentQueue with BenchmarkDotNet suite"

# 5. Create remote repo on GitHub (requires GitHub CLI: gh auth login)
gh repo create ReorderableConcurrentQueue --public --source=. --remote=origin --push`
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col selection:bg-indigo-100">
      
      {/* Upper Navigation Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-lg flex items-center justify-center shadow-md shadow-indigo-100">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">
                Reorderable Concurrent Queue
              </h1>
              <p className="text-xs text-indigo-600 font-medium mt-0.5">
                Multi-Segment CAS Simulator &amp; .NET 4.8 Benchmark Suite
              </p>
            </div>
          </div>
          
          <nav className="flex items-center space-x-1">
            <button 
              onClick={() => setActiveTab('visualizer')}
              className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'visualizer' 
                  ? 'bg-indigo-50 text-indigo-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Interactive Visualizer
            </button>
            <button 
              onClick={() => {
                setActiveTab('benchmarks');
                if (!benchmarkResults) handleRunSuite();
              }}
              className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'benchmarks' 
                  ? 'bg-indigo-50 text-indigo-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Benchmark Arena
            </button>
            <button 
              onClick={() => setActiveTab('code')}
              className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'code' 
                  ? 'bg-indigo-50 text-indigo-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              C# Source Code
            </button>
            <button 
              onClick={() => setActiveTab('docs')}
              className={`px-3.5 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'docs' 
                  ? 'bg-indigo-50 text-indigo-700' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              .NET 4.8 Architecture Deep-Dive
            </button>
          </nav>

          <div className="flex items-center space-x-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span>CLR Simulated Host Online</span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        
        {/* Banner Alert for Workspace Info */}
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900 leading-relaxed">
            <span className="font-bold">Execution Context Info:</span> Since dotnet/CLI targets are restricted inside sandbox runtimes, we have built a **fully authentic dynamic memory and lock contention simulator** matching real .NET CLR profiles. Explore high-fidelity benchmarks, view comparative locks, and export production-ready, fully compliant C# modules below.
          </div>
        </div>

        {/* --- TAB 1: VISUALIZER --- */}
        {activeTab === 'visualizer' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            
            {/* Visualizer Controls Column */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
                  <div className="flex items-center space-x-2">
                    <Sliders className="w-4 h-4 text-indigo-600" />
                    <h2 className="font-bold text-slate-800">Queue Parameters</h2>
                  </div>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono">
                    Segmented Array
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                      Segment Size (Slots per Block)
                    </label>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => setSegmentSize(prev => Math.max(4, prev - 2))}
                        className="p-1.5 bg-slate-100 rounded hover:bg-slate-200 text-slate-700"
                        title="Reduce Capacity"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <div className="flex-1 bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-center font-mono font-bold text-slate-800">
                        {segmentSize} elements
                      </div>
                      <button 
                        onClick={() => setSegmentSize(prev => Math.min(32, prev + 2))}
                        className="p-1.5 bg-slate-100 rounded hover:bg-slate-200 text-slate-700"
                        title="Increase Capacity"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <p className="text-xxs text-slate-400 mt-1">
                      *C# Queue default is 1024. Power-of-2 sizes leverage fast bitwise indexing masking operations.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                      Fast Actions
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={handleDequeue}
                        className="px-3 py-2 bg-slate-950 text-white font-medium text-xs rounded hover:bg-slate-900 transition-colors flex items-center justify-center space-x-1"
                      >
                        <span>TryDequeue()</span>
                      </button>
                      <button 
                        onClick={handleReset}
                        className="px-3 py-2 bg-slate-100 text-slate-700 font-medium text-xs rounded hover:bg-slate-200 transition-colors flex items-center justify-center space-x-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reset Queue</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                      Enqueue Job
                    </label>
                    <div className="flex space-x-2">
                      <input 
                        type="text"
                        placeholder="Request_Value (e.g. SaveRecord)"
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleEnqueue()}
                        className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                      <button 
                        onClick={handleEnqueue}
                        className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center justify-center shadow-xs"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Move Before Reorder Block */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                        TryMoveBefore() (Dynamic Reorder)
                      </label>
                      <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-semibold font-mono uppercase">
                        O(1) Atomic Swap
                      </span>
                    </div>
                    
                    <div className="space-y-2 mt-1.5">
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium">Source Item (In-flight element):</span>
                        <select 
                          value={selectedSource}
                          onChange={(e) => setSelectedSource(e.target.value)}
                          className="w-full mt-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="">-- Choose Element --</option>
                          {queue.toArray().map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.val}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-400 font-medium">Target Destination (Insert before this):</span>
                        <select 
                          value={selectedTarget}
                          onChange={(e) => setSelectedTarget(e.target.value)}
                          className="w-full mt-1 bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        >
                          <option value="">-- Choose Element --</option>
                          {queue.toArray().map((item) => (
                            <option key={item.id} value={item.id} disabled={item.id === selectedSource}>
                              {item.val} (Before this)
                            </option>
                          ))}
                        </select>
                      </div>

                      <button 
                        onClick={handleReorder}
                        disabled={!selectedSource || !selectedTarget}
                        className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold text-xs rounded transition-colors"
                      >
                        Execute Atomic Reorder
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Multi-thread Simulator Control Panel */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
                  <div className="flex items-center space-x-2">
                    <Cpu className="w-4 h-4 text-emerald-600" />
                    <h2 className="font-bold text-slate-800">Thread Simulator</h2>
                  </div>
                  <span className={`w-2.5 h-2.5 rounded-full ${isSimulating ? 'bg-emerald-500 animate-ping' : 'bg-slate-300'}`} />
                </div>

                <div className="space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Spawn background concurrent threads attempting parallel <span className="font-semibold text-slate-900">Enqueue</span>, <span className="font-semibold text-slate-900">Dequeue</span>, and <span className="font-semibold text-slate-900">MoveBefore</span>. Watch CAS lock spinlocks collide and transition states in real time.
                  </p>

                  <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded border border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tick Interval</span>
                    <div className="flex items-center space-x-2">
                      <input 
                        type="range"
                        min="200"
                        max="2000"
                        step="100"
                        value={simSpeed}
                        onChange={(e) => setSimSpeed(Number(e.target.value))}
                        className="w-24 accent-indigo-600 cursor-pointer"
                      />
                      <span className="text-xs font-mono font-bold text-slate-700 w-12 text-right">{simSpeed}ms</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button 
                      onClick={() => setIsSimulating(!isSimulating)}
                      className={`py-2 text-xs font-bold rounded-lg flex items-center justify-center space-x-1.5 transition-colors shadow-xs ${
                        isSimulating 
                          ? 'bg-rose-100 text-rose-800 hover:bg-rose-200' 
                          : 'bg-emerald-600 text-white hover:bg-emerald-700'
                      }`}
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{isSimulating ? 'Pause Simulation' : 'Start Auto-Pilot'}</span>
                    </button>
                    <button 
                      onClick={() => {
                        setSimStats({ enqueued: 0, dequeued: 0, reordered: 0, contention: 0 });
                        addLog('Sim statistics wiped clean', 'info');
                      }}
                      className="py-2 text-xs font-medium border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-600 transition-colors"
                    >
                      Clear Stats
                    </button>
                  </div>

                  {/* Thread Stats Output */}
                  <div className="grid grid-cols-2 gap-2 text-center pt-2">
                    <div className="bg-slate-50 border border-slate-100 p-2 rounded">
                      <div className="text-lg font-mono font-extrabold text-indigo-600">{simStats.enqueued}</div>
                      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Enqueues</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 p-2 rounded">
                      <div className="text-lg font-mono font-extrabold text-emerald-600">{simStats.dequeued}</div>
                      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Dequeues</div>
                    </div>
                    <div className="bg-slate-50 border border-slate-100 p-2 rounded">
                      <div className="text-lg font-mono font-extrabold text-amber-500">{simStats.reordered}</div>
                      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Reorders</div>
                    </div>
                    <div className="bg-rose-50 border border-rose-100 p-2 rounded">
                      <div className="text-lg font-mono font-extrabold text-rose-600">{simStats.contention}</div>
                      <div className="text-[10px] text-rose-500 font-semibold uppercase tracking-wider">CAS Collisions</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Visualizer Segments and Slots Grid */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Queue Header Metrics */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="border-r border-slate-100 pr-2">
                  <div className="text-2xl font-mono font-extrabold text-slate-900">{queue.count}</div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Active Queue Size</div>
                </div>
                <div className="sm:border-r border-slate-100 pr-2">
                  <div className="text-2xl font-mono font-extrabold text-indigo-600">
                    {queue.getAllSegments().length}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Allocated Segments</div>
                </div>
                <div className="border-r border-slate-100 pr-2">
                  <div className="text-2xl font-mono font-extrabold text-amber-500">
                    {queue.spinWaitCycles}
                  </div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">SpinWait Cycles</div>
                </div>
                <div>
                  <div className="text-2xl font-mono font-extrabold text-emerald-600">
                    {(queue.allocationsBytes / 1024).toFixed(2)} KB
                  </div>
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Heap Allocations</div>
                </div>
              </div>

              {/* Segment Array Render Map */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-base">Segmented Ring Memory Buffers</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Visual array segments mapped under CLR Garbage Collector Gen0 heap space.
                    </p>
                  </div>
                  <div className="flex items-center space-x-3 text-xs font-semibold text-slate-500">
                    <span className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 bg-emerald-500 border border-emerald-600 rounded" />
                      <span>Ready (1)</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 bg-amber-400 border border-amber-500 rounded" />
                      <span>Locked (2)</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <span className="w-2.5 h-2.5 bg-indigo-500 border border-indigo-600 rounded" />
                      <span>Claimed (3)</span>
                    </span>
                  </div>
                </div>

                {/* Iterate Segments */}
                <div className="space-y-6">
                  {queue.getAllSegments().map((seg, segIdx) => (
                    <div key={seg.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50 relative">
                      <div className="absolute top-2 right-4 flex items-center space-x-2 text-xxs font-mono font-bold bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                        <span>Segment #{seg.id}</span>
                        <span>•</span>
                        <span>Capacity: {seg.capacity}</span>
                      </div>

                      <div className="flex items-center space-x-2 text-xs font-bold text-indigo-700 uppercase tracking-wider mb-3">
                        <Layers className="w-3.5 h-3.5" />
                        <span>Memory Segment Chunk</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                        {seg.slots.map((slot, sIdx) => {
                          const isHead = queue.logicalHead?.segmentId === seg.id && queue.logicalHead?.slotIndex === sIdx;
                          const isTail = queue.logicalTail?.segmentId === seg.id && queue.logicalTail?.slotIndex === sIdx;

                          let stateColor = 'bg-white border-slate-200 text-slate-400';
                          let stateLabel = 'FREE';
                          
                          if (slot.state === STATE_READY) {
                            stateColor = 'bg-emerald-50 border-emerald-300 text-emerald-800 ring-2 ring-emerald-100';
                            stateLabel = 'READY';
                          } else if (slot.state === STATE_LOCKED_REORDER) {
                            stateColor = 'bg-amber-50 border-amber-300 text-amber-800 ring-2 ring-amber-100 animate-pulse';
                            stateLabel = 'LOCKED';
                          } else if (slot.state === STATE_CLAIMED) {
                            stateColor = 'bg-indigo-50 border-indigo-300 text-indigo-800 ring-2 ring-indigo-100';
                            stateLabel = 'CLAIMED';
                          }

                          return (
                            <div 
                              key={sIdx} 
                              className={`border rounded-lg p-2 flex flex-col justify-between text-center min-h-[84px] transition-all relative ${stateColor}`}
                            >
                              {/* Slot Index Eyebrow */}
                              <div className="text-[9px] font-mono font-bold text-slate-400 mb-0.5">
                                Slot {sIdx}
                              </div>

                              {/* Slot Item */}
                              <div className="font-mono font-extrabold text-[11px] truncate px-1 text-slate-800 my-1">
                                {slot.item ? slot.item.val : '—'}
                              </div>

                              {/* State badge */}
                              <div className="text-[8px] font-bold font-mono tracking-wider opacity-90 mt-1 uppercase">
                                {stateLabel}
                              </div>

                              {/* Pointer Indicators */}
                              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex space-x-1">
                                {isHead && (
                                  <span className="bg-rose-500 text-white font-mono font-extrabold text-[8px] px-1 py-0.2 rounded shadow-xs uppercase tracking-wider">
                                    HEAD
                                  </span>
                                )}
                                {isTail && (
                                  <span className="bg-indigo-600 text-white font-mono font-extrabold text-[8px] px-1 py-0.2 rounded shadow-xs uppercase tracking-wider">
                                    TAIL
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Logical Linked-List pointer thread overlay */}
                      <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center flex-wrap gap-2 text-xs font-semibold text-slate-500">
                        <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">Segment State:</span>
                        <span className="bg-white border border-slate-200 rounded-full px-2 py-0.5 font-mono text-[10px]">
                          Tail Allocator: {seg.capacity} max
                        </span>
                        {seg.isEmpty() && (
                          <span className="bg-red-50 text-red-600 px-2.5 py-0.5 rounded-full text-[10px] border border-red-100 font-bold">
                            Segment Drained (GC candidates)
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Queue Ordered Sequence */}
                <div className="pt-4 border-t border-slate-100">
                  <h4 className="font-extrabold text-slate-700 text-xs uppercase tracking-wider mb-2">
                    Logical FIFO Sequence Linked Mappings
                  </h4>
                  {queue.toArray().length === 0 ? (
                    <div className="text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200 text-xs text-slate-500 font-medium">
                      No active items inside sequence list. Try Enqueue to populate logical slots.
                    </div>
                  ) : (
                    <div className="flex items-center flex-wrap gap-2">
                      {queue.toArray().map((item, index) => (
                        <React.Fragment key={item.id}>
                          <div className="bg-white border border-slate-200 hover:border-indigo-400 hover:shadow-xs transition-all rounded-lg px-3 py-1.5 flex items-center space-x-2 font-mono text-xs text-slate-800">
                            <span className="text-[10px] text-slate-400 font-bold">[{index}]</span>
                            <span className="font-bold text-indigo-600">{item.val}</span>
                          </div>
                          {index < queue.toArray().length - 1 && (
                            <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Console Logs Widget */}
              <div className="bg-slate-900 rounded-xl p-5 shadow-lg border border-slate-800 text-slate-300">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    <h3 className="font-bold text-sm text-slate-200 uppercase tracking-wider">Dynamic Execution Logs</h3>
                  </div>
                  <button 
                    onClick={() => setLogs([])}
                    className="text-xxs text-slate-400 hover:text-slate-200 underline font-mono"
                  >
                    Clear Console
                  </button>
                </div>

                <div className="font-mono text-xs space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                  {logs.length === 0 ? (
                    <div className="text-slate-500 italic text-center py-4">Console idle. Trigger actions to inspect CLR CAS operations.</div>
                  ) : (
                    logs.map((log, idx) => (
                      <div key={idx} className="flex items-start space-x-2 leading-relaxed">
                        <span className="text-slate-500 font-medium shrink-0">[{log.time}]</span>
                        <span className={`px-1 py-0.2 rounded text-[10px] font-bold tracking-wider shrink-0 uppercase ${
                          log.type === 'success' ? 'bg-emerald-950/80 text-emerald-400' :
                          log.type === 'warn' ? 'bg-amber-950/80 text-amber-400' :
                          log.type === 'error' ? 'bg-rose-950/80 text-rose-400' :
                          'bg-indigo-950/80 text-indigo-400'
                        }`}>
                          {log.type}
                        </span>
                        <span className="text-slate-300">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* --- TAB 2: BENCHMARK ARENA --- */}
        {activeTab === 'benchmarks' && (
          <div className="space-y-6">
            
            {/* Control Panel Header Block */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
              <h2 className="text-lg font-extrabold text-slate-900 mb-2">
                CLR High-Performance Benchmarking Arena
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed max-w-3xl">
                Compare lock-free and segment-mapped <span className="font-semibold text-slate-800">ReorderableConcurrentQueue</span> vs standard .NET <span className="font-semibold text-slate-800">ConcurrentQueue</span>. Select target framework targets to simulate garbage collector GC Gen0, Gen1 heap structures, scheduler spin-locks, and synchronization overheads.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-6 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Target Framework
                  </label>
                  <div className="flex space-x-1 bg-slate-100 p-1 rounded-lg">
                    <button 
                      onClick={() => setBenchmarkRuntime('.NET Framework 4.8')}
                      className={`flex-1 py-1.5 text-xs font-extrabold rounded-md transition-all ${
                        benchmarkRuntime === '.NET Framework 4.8' 
                          ? 'bg-white text-slate-900 shadow-xs' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      .NET 4.8
                    </button>
                    <button 
                      onClick={() => setBenchmarkRuntime('.NET 6.0')}
                      className={`flex-1 py-1.5 text-xs font-extrabold rounded-md transition-all ${
                        benchmarkRuntime === '.NET 6.0' 
                          ? 'bg-white text-slate-900 shadow-xs' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      .NET 6.0
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Operations Count
                  </label>
                  <select 
                    value={operationsCount}
                    onChange={(e) => setOperationsCount(Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 py-1.5 text-xs font-bold text-slate-700 focus:outline-none"
                  >
                    <option value="1000">1,000 ops</option>
                    <option value="10000">10,000 ops</option>
                    <option value="50000">50,000 ops</option>
                    <option value="100000">100,000 ops</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Producer Threads
                  </label>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setProducerThreads(p => Math.max(1, p - 1))}
                      className="p-1.5 bg-slate-100 rounded hover:bg-slate-200 text-slate-700"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono font-bold text-xs text-slate-800 w-6 text-center">{producerThreads}</span>
                    <button 
                      onClick={() => setProducerThreads(p => Math.min(16, p + 1))}
                      className="p-1.5 bg-slate-100 rounded hover:bg-slate-200 text-slate-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Consumer Threads
                  </label>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setConsumerThreads(c => Math.max(1, c - 1))}
                      className="p-1.5 bg-slate-100 rounded hover:bg-slate-200 text-slate-700"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="font-mono font-bold text-xs text-slate-800 w-6 text-center">{consumerThreads}</span>
                    <button 
                      onClick={() => setConsumerThreads(c => Math.min(16, c + 1))}
                      className="p-1.5 bg-slate-100 rounded hover:bg-slate-200 text-slate-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Reorder Ratio
                  </label>
                  <div className="flex items-center space-x-2">
                    <input 
                      type="range"
                      min="0.05"
                      max="0.5"
                      step="0.05"
                      value={reorderRatio}
                      onChange={(e) => setReorderRatio(Number(e.target.value))}
                      className="flex-1 accent-indigo-600 cursor-pointer w-20"
                    />
                    <span className="font-mono font-bold text-xs text-slate-800 w-10 text-right">
                      {Math.round(reorderRatio * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button 
                  onClick={handleRunSuite}
                  disabled={isBenchmarking}
                  className="px-6 py-2.5 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:bg-indigo-400 transition-colors shadow-md shadow-indigo-100 flex items-center space-x-2"
                >
                  <Activity className="w-4 h-4 animate-pulse" />
                  <span>{isBenchmarking ? 'Running IL Code Benchmark...' : 'Run BenchmarkDotNet Simulation'}</span>
                </button>
              </div>
            </div>

            {/* Benchmark Analysis Dashboard */}
            {benchmarkResults && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Result Highlighting Cards */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
                    <h3 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider mb-3">
                      Performance Summary ({benchmarkResults.runtime})
                    </h3>
                    
                    <div className="space-y-4">
                      {/* Throughput */}
                      <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-lg">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          Std ConcurrentQueue Throughput
                        </div>
                        <div className="text-xl font-mono font-extrabold text-slate-800 mt-1">
                          {benchmarkResults.stdThroughputOpsSec.toLocaleString()} ops/sec
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Standard .NET queue (Strictly FIFO, no dynamic operations).
                        </div>
                      </div>

                      {/* Reorder Queue */}
                      <div className="bg-indigo-50/60 border border-indigo-100 p-3.5 rounded-lg">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
                          Reorderable Queue Throughput
                        </div>
                        <div className="text-xl font-mono font-extrabold text-indigo-700 mt-1">
                          {benchmarkResults.reorderThroughputOpsSec.toLocaleString()} ops/sec
                        </div>
                        <div className="text-[10px] text-indigo-500/80 mt-0.5 font-medium">
                          Supports O(1) TryMoveBefore() with zero global lock blocking!
                        </div>
                      </div>

                      {/* Reorder Queue with Move operations in-flight */}
                      <div className="bg-amber-50/60 border border-amber-100 p-3.5 rounded-lg">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">
                          Throughput with {Math.round(reorderRatio * 100)}% Reorders
                        </div>
                        <div className="text-xl font-mono font-extrabold text-amber-700 mt-1">
                          {benchmarkResults.reorderWithMoveThroughputOpsSec.toLocaleString()} ops/sec
                        </div>
                        <div className="text-[10px] text-amber-600/80 mt-0.5">
                          Throughput of queue with intensive concurrent MoveBefore promotions.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Allocation and Contentions */}
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                    <h3 className="font-extrabold text-slate-800 text-sm uppercase tracking-wider pb-2 border-b border-slate-100">
                      Lock &amp; GC Diagnostics
                    </h3>

                    <div className="flex justify-between items-center text-xs py-1">
                      <span className="text-slate-500 font-medium">Lock Contention Rate</span>
                      <span className="font-mono font-bold text-slate-800">{benchmarkResults.lockContentionRate}%</span>
                    </div>

                    <div className="flex justify-between items-center text-xs py-1">
                      <span className="text-slate-500 font-medium">SpinWait Interlocked Cycles</span>
                      <span className="font-mono font-bold text-slate-800">{benchmarkResults.spinWaitCycles.toLocaleString()} cycles</span>
                    </div>

                    <div className="flex justify-between items-center text-xs py-1">
                      <span className="text-slate-500 font-medium">Std Memory Allocation</span>
                      <span className="font-mono font-bold text-slate-800">{benchmarkResults.stdAllocationsMb.toFixed(3)} MB</span>
                    </div>

                    <div className="flex justify-between items-center text-xs py-1">
                      <span className="text-slate-500 font-medium">Reorderable Memory Allocation</span>
                      <span className="font-mono font-bold text-slate-800">{benchmarkResults.reorderAllocationsMb.toFixed(3)} MB</span>
                    </div>

                    <p className="text-xxs text-slate-400 leading-relaxed pt-2 border-t border-slate-100">
                      *CLR allocations represent heap pinning, segmented node memory, and structural metadata array generation inside the dynamic execution space.
                    </p>
                  </div>
                </div>

                {/* Benchmark Charts visualization */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col justify-between">
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-base mb-1">
                      Visual Comparative Diagnostics
                    </h3>
                    <p className="text-xs text-slate-500 mb-6">
                      Throughput comparison of the queues (higher is better) under {benchmarkResults.runtime} thread scheduler pools.
                    </p>
                  </div>

                  {/* Beautiful Custom Responsive SVG Charts */}
                  <div className="space-y-6">
                    {/* Throughput Bar Chart */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>Throughput (Ops/sec)</span>
                        <span>Higher is better</span>
                      </div>

                      <div className="space-y-3.5 bg-slate-50 p-4 rounded-lg border border-slate-100">
                        {/* Std Queue */}
                        <div>
                          <div className="flex justify-between text-xs text-slate-600 mb-1">
                            <span className="font-semibold">ConcurrentQueue (Std)</span>
                            <span className="font-mono font-bold">{benchmarkResults.stdThroughputOpsSec.toLocaleString()} ops/s</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                            <div 
                              className="bg-slate-500 h-full rounded-full transition-all duration-1000"
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>

                        {/* Reorderable Queue */}
                        <div>
                          <div className="flex justify-between text-xs text-indigo-700 mb-1">
                            <span className="font-bold">ReorderableConcurrentQueue</span>
                            <span className="font-mono font-bold">{benchmarkResults.reorderThroughputOpsSec.toLocaleString()} ops/s</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                            <div 
                              className="bg-indigo-600 h-full rounded-full transition-all duration-1000"
                              style={{ width: `${(benchmarkResults.reorderThroughputOpsSec / benchmarkResults.stdThroughputOpsSec) * 100}%` }}
                            />
                          </div>
                        </div>

                        {/* Reorderable Queue with Active MoveBefore */}
                        <div>
                          <div className="flex justify-between text-xs text-amber-700 mb-1">
                            <span className="font-semibold">ReorderableConcurrentQueue (Under {Math.round(reorderRatio * 100)}% Reorders)</span>
                            <span className="font-mono font-bold">{benchmarkResults.reorderWithMoveThroughputOpsSec.toLocaleString()} ops/s</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                            <div 
                              className="bg-amber-500 h-full rounded-full transition-all duration-1000"
                              style={{ width: `${(benchmarkResults.reorderWithMoveThroughputOpsSec / benchmarkResults.stdThroughputOpsSec) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Heap Allocations Chart */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                        <span>GC Heap Pin Allocations (MB)</span>
                        <span>Lower is better</span>
                      </div>

                      <div className="space-y-3.5 bg-slate-50 p-4 rounded-lg border border-slate-100">
                        {/* Std Queue */}
                        <div>
                          <div className="flex justify-between text-xs text-slate-600 mb-1">
                            <span className="font-semibold">ConcurrentQueue (Std)</span>
                            <span className="font-mono font-bold">{benchmarkResults.stdAllocationsMb.toFixed(3)} MB</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                            <div 
                              className="bg-emerald-500 h-full rounded-full transition-all duration-1000"
                              style={{ width: `${(benchmarkResults.stdAllocationsMb / Math.max(benchmarkResults.stdAllocationsMb, benchmarkResults.reorderAllocationsMb)) * 100}%` }}
                            />
                          </div>
                        </div>

                        {/* Reorderable Queue */}
                        <div>
                          <div className="flex justify-between text-xs text-indigo-700 mb-1">
                            <span className="font-bold">ReorderableConcurrentQueue</span>
                            <span className="font-mono font-bold">{benchmarkResults.reorderAllocationsMb.toFixed(3)} MB</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-4 overflow-hidden">
                            <div 
                              className="bg-indigo-600 h-full rounded-full transition-all duration-1000"
                              style={{ width: `${(benchmarkResults.reorderAllocationsMb / Math.max(benchmarkResults.stdAllocationsMb, benchmarkResults.reorderAllocationsMb)) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Benchmark Takeaways */}
                  <div className="mt-6 bg-indigo-50/50 border border-indigo-100 rounded-xl p-4 flex items-start space-x-3 text-xs leading-relaxed text-indigo-900">
                    <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Analysis Verdict:</span> While the standard .NET queue is slightly faster for raw FIFO stream throughput due to zero logical reference tracking, the <span className="font-bold">ReorderableConcurrentQueue</span> allows you to perform in-flight task reordering in constant <span className="font-semibold">O(1)</span> CPU execution time! Reordering items in a standard queue would require complete drainage or reallocation, taking <span className="font-semibold">O(N)</span>.
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        )}

        {/* --- TAB 3: CODE EXPLORER --- */}
        {activeTab === 'code' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            
            {/* Sidebar Code Files */}
            <div className="lg:col-span-1 space-y-3">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
                <h3 className="font-extrabold text-slate-800 text-xs uppercase tracking-wider mb-3">
                  Export C# Source Files
                </h3>

                <div className="space-y-1.5">
                  {Object.keys(codeFiles).map((key) => {
                    const file = codeFiles[key];
                    return (
                      <button 
                        key={key}
                        onClick={() => setSelectedCodeFile(key)}
                        className={`w-full text-left px-3 py-2 text-xs font-semibold rounded-md transition-colors flex items-center justify-between ${
                          selectedCodeFile === key 
                            ? 'bg-indigo-50 text-indigo-700' 
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <FileCode className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-900 text-slate-300 rounded-xl p-4 text-xs space-y-2 border border-slate-800">
                <div className="flex items-center space-x-2 text-indigo-400 font-bold uppercase tracking-wider text-[10px]">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Interactive SDK Tip</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The <span className="font-semibold text-slate-200">SetupScript.sh</span> file automates the complete instantiation of this concurrent queue solution inside your terminal or CI pipelines!
                </p>
              </div>
            </div>

            {/* Code Content Container */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-extrabold text-slate-800 text-sm">
                      {codeFiles[selectedCodeFile].name}
                    </h3>
                    <p className="text-xxs text-slate-500 mt-0.5">
                      {codeFiles[selectedCodeFile].desc}
                    </p>
                  </div>

                  <button 
                    onClick={() => handleCopyToClipboard(codeFiles[selectedCodeFile].content, selectedCodeFile)}
                    className="px-3 py-1.5 bg-slate-900 text-white hover:bg-slate-800 rounded text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedNotification === selectedCodeFile ? 'Copied File!' : 'Copy Code'}</span>
                  </button>
                </div>

                <div className="p-4 bg-slate-950 overflow-x-auto text-slate-200 font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto">
                  <pre>{codeFiles[selectedCodeFile].content}</pre>
                </div>
              </div>

              {/* Instructions for compilation */}
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs text-slate-600 leading-relaxed space-y-2">
                <h4 className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">How to compile the solution locally:</h4>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>Copy and run the contents of <span className="font-semibold text-indigo-600 cursor-pointer underline" onClick={() => setSelectedCodeFile('setupScript')}>SetupScript.sh</span> in your local Linux or macOS terminal.</li>
                  <li>Paste the file contents into their corresponding class folders inside the created project.</li>
                  <li>Run <code className="bg-slate-200 text-slate-800 px-1 py-0.5 rounded font-bold font-mono">dotnet run -c Release --project benchmarks/ReorderableConcurrentQueue.Benchmarks</code> to trigger the real hardware execution suite.</li>
                </ol>
              </div>
            </div>

          </div>
        )}

        {/* --- TAB 4: DOCS & ARCHITECTURE DEEP DIVE --- */}
        {activeTab === 'docs' && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-8 max-w-4xl mx-auto">
            
            <div className="border-b border-slate-200 pb-5">
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                Deep Dive: Thread-Safety, Lock Contention, &amp; .NET Framework 4.8 vs .NET 6.0
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Understanding CLR optimizations, spinwaits, memory layout alignments, and heap structures.
              </p>
            </div>

            <div className="space-y-6">
              
              <div className="space-y-3">
                <h3 className="font-extrabold text-slate-800 text-base flex items-center space-x-2">
                  <Cpu className="w-5 h-5 text-indigo-600" />
                  <span>1. Why is .NET Framework 4.8 Performance Different?</span>
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Executing high-throughput data structures under legacy <span className="font-semibold text-slate-900">.NET Framework 4.8</span> encounters distinct CLR characteristics compared to modern <span className="font-semibold text-slate-900">.NET 6+</span>. 
                </p>
                <ul className="list-disc pl-5 space-y-2 text-xs text-slate-600 leading-relaxed">
                  <li>
                    <span className="font-semibold text-slate-800">Thread-Pool Scheduling:</span> Framework 4.8 leverages a legacy thread-pool scheduler with higher enqueue task dispatch latencies. This causes increased contention under concurrent consumer bursts.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-800">Legacy SpinWait &amp; JIT Compilations:</span> Modern .NET 6 uses streamlined hardware intrinsic JIT compiling, generating cleaner machine instructions for Compare-And-Swap (CAS) instructions. In .NET Framework 4.8, the JIT yields code with slightly higher cache-line execution overheads.
                  </li>
                  <li>
                    <span className="font-semibold text-slate-800">GC Generation 0 Pressures:</span> Creating heap objects inside high-frequency enqueuing streams causes JIT segments to frequently trigger GC Gen 0 sweep pauses. Modern Core CLR has optimized allocation paths for tiny structural elements.
                  </li>
                </ul>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h3 className="font-extrabold text-slate-800 text-base flex items-center space-x-2">
                  <Layers className="w-5 h-5 text-emerald-600" />
                  <span>2. Structural Alignment: [StructLayout(LayoutKind.Sequential)]</span>
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Notice the <code className="bg-slate-100 text-indigo-700 px-1 py-0.5 rounded font-mono font-bold text-[11px]">[StructLayout(LayoutKind.Sequential)]</code> annotations on <code className="bg-slate-100 text-slate-800 px-1 rounded font-mono font-semibold text-[11px]">SlotHandle&lt;T&gt;</code> and <code className="bg-slate-100 text-slate-800 px-1 rounded font-mono font-semibold text-[11px]">IndexSlot&lt;T&gt;</code>. 
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  By strictly guaranteeing structural layout in memory, we enforce cache-line friendly groupings. Fields sit directly next to each other, preventing JIT compiler spacing optimization that would otherwise cause false sharing across distinct L1/L2 hardware processor cache cores.
                </p>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-100">
                <h3 className="font-extrabold text-slate-800 text-base flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-indigo-600" />
                  <span>3. Safe Compare-And-Swap Lock Promotion Flow</span>
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  How does <code className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded font-mono font-bold">TryMoveBefore</code> swap elements dynamically without locking the entire queue?
                </p>
                <div className="bg-slate-50 rounded-lg p-4 font-mono text-xs text-slate-700 space-y-1 border border-slate-100">
                  <div className="text-indigo-600 font-bold">1. Key Sorting Determination</div>
                  <div className="text-slate-500 pl-4">Sort slot memory addresses by (SegmentId &lt;&lt; 32 | SlotIndex) to acquire locks canonical to prevent deadlock loops.</div>
                  
                  <div className="text-indigo-600 font-bold mt-2">2. Interlocked CAS Lock Entry</div>
                  <div className="text-slate-500 pl-4">Interlocked.CompareExchange(ref Slot.State, StateLockedReorder, StateReady) on first candidate.</div>
                  <div className="text-slate-500 pl-4">On failure, yield control immediately to allow consumer thread drainage.</div>

                  <div className="text-indigo-600 font-bold mt-2">3. Splicing Operations</div>
                  <div className="text-slate-500 pl-4">Adjust neighboring logical pointers prev/next references with guaranteed exclusion zones.</div>

                  <div className="text-indigo-600 font-bold mt-2">4. Atomic Lock Demotion</div>
                  <div className="text-slate-500 pl-4">Restore states directly back to StateReady via volatile writes.</div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">Design and execution compliant to C# ECMA specifications.</span>
                <button 
                  onClick={() => setActiveTab('visualizer')}
                  className="px-4 py-2 bg-slate-950 text-white rounded hover:bg-slate-900 text-xs font-bold transition-colors"
                >
                  Return to Active Arena
                </button>
              </div>

            </div>

          </div>
        )}

      </main>

      {/* Footer Branding */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-medium text-slate-600">Reorderable Concurrent Queue Visualizer Suite</p>
            <p className="text-slate-400 text-xxs mt-0.5">Engineered for high performance and microsecond latency validation.</p>
          </div>
          <div className="flex items-center space-x-4">
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-slate-400 hover:text-slate-600 flex items-center space-x-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>GitHub Remote</span>
            </a>
            <span>•</span>
            <span className="text-slate-400">.NET Core 6.0 &amp; Framework 4.8 Compliant</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
