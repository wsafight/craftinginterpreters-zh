---
title: 14. 字节码块
description: Chunks of Bytecode
---

> 如果你发现你几乎把所有的时间都花在了理论上，那就开始把一些注意力转向实际的东西；这会提高你的理论水平。如果你发现你几乎把所有的时间都花在了实践上，那就开始把一些注意力转向理论上的东西；这将改善你的实践。
>
> ——Donald Knuth

我们已经有了一个 Lox 的完整实现 jlox，那么为什么这本书还没有结束呢？部分原因是 jlox 依赖 JVM 为我们做很多事情[^1]。如果我们想要了解一个解释器是如何工作的，我们就需要自己构建这些零碎的东西。

jlox 不够用的一个更根本的原因在于，它太慢了。树遍历解释器对于某些高级的声明式语言来说是不错的，但是对于通用的命令式语言——即使是 Lox 这样的“脚本”语言——这是行不通的。以下面的小脚本为例[^2]：

```javascript
fun fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}

var before = clock();
print fib(40);
var after = clock();
print after - before;
```

在我的笔记本电脑上，jlox 大概需要 72 秒的时间来执行。一个等价的 C 程序在半秒内可以完成。我们的动态类型的脚本语言永远不可能像手动管理内存的静态类型语言那样快，但我们没必要满足于慢两个数量级以上的速度。

我们可以把 jlox 放在性能分析器中运行，并进行调优和调整热点，但这也只能到此为止了。它的执行模型（遍历 AST）从根本上说就是一个错误的设计。我们无法将其微优化到我们想要的性能，就像你无法将 AMC Gremlin 打磨成 SR-71 Blackbird 一样。

我们需要重新考虑核心模型。本章将介绍这个模型——字节码，并开始我们的新解释器，clox。

## 14.1 字节码？

在工程领域，很少有选择是不需要权衡的。为了更好地理解我们为什么要使用字节码，让我们将它与几个备选方案进行比较。

### 14.1.1 为什么不遍历 AST？

我们目前的解释器有几个优点：

- 嗯，首先我们已经写好了，它已经完成了。它能完成的主要原因是这种风格的解释器*实现起来非常简单*。代码的运行时表示直接映射到语法。从解析器到我们在运行时需要的数据结构，几乎都毫不费力。

- 它是可移植的。我们目前的解释器是使用 Java 编写的，可以在 Java 支持的任何平台上运行。我们可以用同样的方法在 C 语言中编写一个新的实现，并在世界上几乎所有平台上编译并运行我们的语言。

这些是真正的优势。但是，另一方面，它的内存使用效率不高。每一段语法都会变成一个 AST 节点。像`1+2`这样的 Lox 表达式会变成一连串的对象，对象之间有很多指针，就像[^3]：

![The tree of Java objects created to represent '1 + 2'.](./ast.png)

每个指针都会给对象增加 32 或 64 比特的开销。更糟糕的是，将我们的数据散布在一个松散连接的对象网络中的堆上，会对空间局部性造成影响。

现代 CPU 处理数据的速度远远超过它们从 RAM 中提取数据的速度。为了弥补这一点，芯片中有多层缓存。如果它需要的一块存储数据已经在缓存中，它就可以更快地被加载。我们谈论的是 100 倍以上的提速。

数据是如何进入缓存的？机器会推测性地为你把数据塞进去。它的启发式方法很简单。每当 CPU 从 RAM 中读取数据时，它就会拉取一块相邻的字节并放到缓存中。

如果我们的程序接下来请求一些在缓存行中的数据，那么我们的 CPU 就能像工厂里一条运转良好的传送带一样运行。我们真的很想利用这一点。为了有效的利用缓存，我们在内存中表示代码的方式应该像读取时一样紧密而有序。

现在抬头看看那棵树。这些子对象可能在任何地方。树遍历器的每一步都会引用子节点，都可能会超出缓存的范围，并迫使 CPU 暂停，直到从 RAM 中拉取到新的数据块（才会继续执行）。仅仅是这些树形节点及其所有指针字段和对象头的开销，就会把对象彼此推离，并将其推出缓存区。

我们的 AST 遍历器在接口调度和 Visitor 模式方面还有其它开销，但仅仅是局部性问题就足以证明使用更好的代码表示是合理的。

### 14.1.2 为什么不编译成本地代码？

如果你想真正快，就要摆脱所有的中间层，一直到最底层——机器码。听起来就很快，_机器码_。

最快的语言所做的是直接把代码编译为芯片支持的本地指令集。从早期工程师真正用机器码手写程序以来，以本地代码为目标一直是最有效的选择。

如果你以前从来没有写过任何机器码，或者是它略微讨人喜欢的近亲汇编语言，那我给你做一个简单的介绍。本地代码是一系列密集的操作，直接用二进制编码。每条指令的长度都在一到几个字节之间，而且几乎是令人头疼的底层指令。“将一个值从这个地址移动到这个寄存器”“将这两个寄存器中的整数相加”，诸如此类。

通过解码和按顺序执行指令来操作 CPU。没有像 AST 那样的树状结构，控制流是通过从代码中的一个点跳到另一个点来实现的。没有中间层，没有开销，没有不必要的跳转或指针寻址。

闪电般的速度，但这种性能是有代价的。首先，编译成本地代码并不容易。如今广泛使用的大多数芯片都有着庞大的拜占庭式架构，其中包含了几十年来积累的大量指令。它们需要复杂的寄存器分配、流水线和指令调度。

当然，你可以把可移植性抛在一边。花费几年时间掌握一些架构，但这仍然只能让你接触到一些流行的指令集。为了让你的语言能在所有的架构上运行，你需要学习所有的指令集，并为每个指令集编写一个单独的后端[^4]。

### 14.1.3 什么是字节码？

记住这两点。一方面，树遍历解释器简单、可移植，而且慢。另一方面，本地代码复杂且特定与平台，但是很快。字节码位于中间。它保留了树遍历型的可移植性——在本书中我们不会编写汇编代码，同时它牺牲了一些简单性来换取性能的提升，虽然没有完全的本地代码那么快。

结构上讲，字节码类似于机器码。它是一个密集的、线性的二进制指令序列。这样可以保持较低的开销，并可以与高速缓存配合得很好。然而，它是一个更简单、更高级的指令集，比任何真正的芯片都要简单。（在很多字节码格式中，每条指令只有一个字节长，因此称为“字节码”）

想象一下，你在用某种源语言编写一个本地编译器，并且你可以全权定义一个尽可能简单的目标架构。字节码就有点像这样，它是一个理想化的幻想指令集，可以让你作为编译器作者的生活更轻松。

当然，幻想架构的问题在于它并不存在。我们提供编写模拟器来解决这个问题，这个模拟器是一个用软件编写的芯片，每次会解释字节码的一条指令。如果你愿意的话，可以叫它*虚拟机（VM）*。

模拟层增加了开销，这是字节码比本地代码慢的一个关键原因。但作为回报，它为我们提供了可移植性[^5]。用像 C 这样的语言来编写我们的虚拟机，它已经被我们所关心的所有机器所支持，这样我们就可以在任何我们喜欢的硬件上运行我们的模拟器。

这就是我们的新解释器 clox 要走的路。我们将追随 Python、Ruby、Lua、OCaml、Erlang 和其它主要语言实现的脚步。在许多方面，我们的 VM 设计将与之前的解释器结构并行。

![Phases of the two implementations. jlox is Parser to Syntax Trees to Interpreter. clox is Compiler to Bytecode to Virtual Machine.](./phases.png)

当然，我们不会严格按照顺序实现这些阶段。像我们之前的解释器一样，我们会反复地构建实现，每次只构建一种语言特性。在这一章中，我们将了解应用程序的框架，并创建用于存储和表示字节码块的数据结构。

## 14.2 开始

除了`main()`还能从哪里开始呢？启动你的文本编辑器，开始输入。

_<u>main.c，创建新文件：</u>_

```c
#include "common.h"

int main(int argc, const char* argv[]) {
  return 0;
}
```

从这颗小小的种子开始，我们将成长为整个 VM。由于 C 提供给我们的东西太少，我们首先需要花费一些时间来培育土壤。其中一部分就在下面的 header 中。

_<u>common.h，创建新文件：</u>_

```c
#ifndef clox_common_h
#define clox_common_h

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#endif
```

在整个解释器中，我们会使用一些类型和常量，这是一个方便放置它们的地方。现在，它是古老的`NULL`、`size_t`，C99 中的布尔类型`bool`，以及显式声明大小的整数类型——`uint8_t`和它的朋友们。

## 14.3 指令块

接下来，我们需要一个模块来定义我们的代码表示形式。我一直使用“chunk”指代字节码序列，所以我们把它作为该模块的正式名称。

_<u>chunk.h，创建新文件：</u>_

```c
#ifndef clox_chunk_h
#define clox_chunk_h

#include "common.h"

#endif
```

在我们的字节码格式中，每个指令都有一个字节的**操作码**（通常简称为**opcode**）。这个数字控制我们要处理的指令类型——加、减、查找变量等。我们在这块定义这些：

_<u>chunk.h，添加代码：</u>_

```c
#include "common.h"
// 新增部分开始
typedef enum {
  OP_RETURN,
} OpCode;
// 新增部分结束
#endif
```

现在，我们从一条指令`OP_RETURN`开始。当我们有一个全功能的 VM 时，这个指令意味着“从当前函数返回”。我承认这还不是完全有用，但是我们必须从某个地方开始下手，而这是一个特别简单的指令，原因我们会在后面讲到。

### 14.3.1 指令动态数组

字节码是一系列指令。最终，我们会与指令一起存储一些其它数据，所以让我们继续创建一个结构体来保存所有这些数据。

_<u>chunk.h，在枚举 OpCode 后添加：</u>_

```c
} OpCode;
// 新增部分开始
typedef struct {
  uint8_t* code;
} Chunk;
// 新增部分结束
#endif
```

目前，这只是一个字节数组的简单包装。由于我们在开始编译块之前不知道数组需要多大，所以它必须是动态的。动态数组是我最喜欢的数据结构之一。这听起来就像是在说香草是我最喜爱的冰淇淋口味，但请听我说完。动态数组提供了：

- 缓存友好，密集存储

- 索引元素查找为常量时间复杂度

- 数组末尾追加元素为常量时间复杂度

这些特性正是我们在 jlox 中以 ArrayList 类的名义一直使用动态数组的原因。现在我们在 C 语言中，可以推出我们自己的动态数组。如果你对动态数组不熟悉，其实这个想法非常简单。除了数组本身，我们还保留了两个数字：数组中已分配的元素数量（容量，capacity）和实际使用的已分配元数数量（计数，count）。

_<u>chunk.h，在结构体 Chunk 中添加代码：</u>_

```c
typedef struct {
  // 新增部分开始
  int count;
  int capacity;
  // 新增部分结束
  uint8_t* code;
} Chunk;
```

当添加元素时，如果计数小于容量，那么数组中已有可用空间。我们将新元素直接存入其中，并修改计数值。

![Storing an element in an array that has enough capacity.](./insert.png)

如果没有多余的容量，那么这个过程会稍微复杂一些。

![Growing the dynamic array before storing an element.](./grow.png)

1. 分配一个容量更大的新数组[^6]。

2. 将旧数组中的已有元素复制到新数组中。

3. 保存新的`capacity`。

4. 删除旧数组。

5. 更新`code`指向新的数组。

6. 现在有了空间，将元素存储在新数组中。

7. 更新`count`。

我们的结构体已经就绪，现在我们来实现和它相关的函数。C 语言没有构造函数，所以我们声明一个函数来初始化一个新的块。

_<u>chunk.h，在结构体 Chunk 后添加：</u>_

```c
} Chunk;
// 新增部分开始
void initChunk(Chunk* chunk);
// 新增部分结束
#endif
```

并这样实现它：

_<u>chunk.c，创建新文件：</u>_

```c
#include <stdlib.h>

#include "chunk.h"

void initChunk(Chunk* chunk) {
  chunk->count = 0;
  chunk->capacity = 0;
  chunk->code = NULL;
}
```

动态数组一开始是完全空的。我们甚至还没有分配原始数组。要将一个字节追加到块的末尾，我们使用一个新函数。

_<u>chunk.h，在 initChunk()方法后添加：</u>_

```c
void initChunk(Chunk* chunk);
// 新增部分开始
void writeChunk(Chunk* chunk, uint8_t byte);
// 新增部分结束
#endif
```

这就是有趣的地方。

_<u>chunk.c，在 initChunk()方法后添加：</u>_

```c
void writeChunk(Chunk* chunk, uint8_t byte) {
  if (chunk->capacity < chunk->count + 1) {
    int oldCapacity = chunk->capacity;
    chunk->capacity = GROW_CAPACITY(oldCapacity);
    chunk->code = GROW_ARRAY(uint8_t, chunk->code,
        oldCapacity, chunk->capacity);
  }

  chunk->code[chunk->count] = byte;
  chunk->count++;
}
```

我们需要做的第一件事是查看当前数组是否已经有容纳新字节的容量。如果没有，那么我们首先需要扩充数组以腾出空间（当我们第一个写入时，数组为`NULL`并且`capacity`为 0，也会遇到这种情况）

要扩充数组，首先我们要算出新容量，然后将数组容量扩充到该大小。这两种低级别的内存操作都在一个新模块中定义。

_<u>chunk.c，添加代码：</u>_

```c
#include "chunk.h"
// 新增部分开始
#include "memory.h"
// 新增部分结束
void initChunk(Chunk* chunk) {
```

这就足够我们开始后面的事情了。

_<u>memory.h，创建新文件：</u>_

```c
#ifndef clox_memory_h
#define clox_memory_h

#include "common.h"

#define GROW_CAPACITY(capacity) \
    ((capacity) < 8 ? 8 : (capacity) * 2)

#endif
```

这个宏会根据给定的当前容量计算出新的容量。为了获得我们想要的性能，重要的部分就是基于旧容量大小进行扩展。我们以 2 的系数增长，这是一个典型的取值。1.5 是另外一个常见的选择。

我们还会处理当前容量为 0 的情况。在这种情况下，我们的容量直接跳到 8，而不是从 1 开始[^7]。这就避免了在数组非常小的时候出现额外的内存波动，代价是在非常小的块中浪费几个字节。

一旦我们知道了所需的容量，就可以使用`GROW_ARRAY()`创建或扩充数组到该大小。

_<u>memory.h，添加代码：</u>_

```c
#define GROW_CAPACITY(capacity) ((capacity) < 8 ? 8 : (capacity) * 2)
// 新增部分开始
#define GROW_ARRAY(type, pointer, oldCount, newCount) \
    (type*)reallocate(pointer, sizeof(type) * (oldCount), \
        sizeof(type) * (newCount))

void* reallocate(void* pointer, size_t oldSize, size_t newSize);
// 新增部分结束
#endif
```

这个宏简化了对`reallocate()`函数的调用，真正的工作就是在其中完成的。宏本身负责获取数组元素类型的大小，并将生成的`void*`转换成正确类型的指针。

这个`reallocate()`函数是我们将在 clox 中用于所有动态内存管理的唯一函数——分配内存，释放内存以及改变现有分配的大小。当我们稍后添加一个需要跟踪内存使用情况的垃圾收集器时，通过单个函数路由所有这些操作是很重要的。

传递给`reallocate()` 函数的两个大小参数控制了要执行的操作：

| oldSize  | newSize                | Operation                                  |
| -------- | ---------------------- | ------------------------------------------ |
| 0        | Non‑zero               | Allocate new block. 分配新块               |
| Non‑zero | 0                      | Free allocation. 释放已分配内存            |
| Non‑zero | Smaller than `oldSize` | Shrink existing allocation. 收缩已分配内存 |
| Non‑zero | Larger than `oldSize`  | Grow existing allocation. 增加已分配内存   |

看起来好像有很多情况需要处理，但下面是其实现：

_<u>memory.c，创建新文件：</u>_

```c
#include <stdlib.h>

#include "memory.h"

void* reallocate(void* pointer, size_t oldSize, size_t newSize) {
  if (newSize == 0) {
    free(pointer);
    return NULL;
  }

  void* result = realloc(pointer, newSize);
  return result;
}
```

当`newSize`为 0 时，我们通过调用`free()`来自己处理回收的情况。其它情况下，我们依赖于 C 标准库的`realloc()`函数。该函数可以方便地支持我们策略中的其它三个场景。当`oldSize`为 0 时，`realloc()` 等同于调用`malloc()`。

有趣的情况是当`oldSize`和`newSize`都不为 0 时。它们会告诉`realloc()`要调整之前分配的块的大小。如果新的大小小于现有的内存块，它就只是更新块的大小，并返回传入的指针。如果新块大小更大，它就会尝试增长现有的内存块[^8]。

只有在该块之后的内存未被使用的情况下，才能这样做。如果没有空间支持块的增长，`realloc()`会分配一个所需大小的*新*的内存块，复制旧的字节，释放旧内存块，然后返回一个指向新内存块的指针。记住，这正是我们的动态数组想要的行为。

因为计算机是有限的物质块，而不是计算机科学理论所认为的完美的数学抽象，如果没有足够的内存，分配就会失败，`reealloc()`会返回`NULL`。我们应该解决这个问题。

_<u>memory.c，在 reallocate()方法中添加：</u>_

```c
  void* result = realloc(pointer, newSize);
  // 新增部分开始
  if (result == NULL) exit(1);
  // 新增部分结束
  return result;
```

如果我们的 VM 不能得到它所需要的内存，那就做不了什么有用的事情，但我们至少可以检测这一点，并立即中止进程，而不是返回一个`NULL`指针，然后让程序运行偏离轨道。

好了，我们可以创建新的块并向其中写入指令。我们完成了吗？不！要记住，我们现在是在 C 语言中，我们必须自己管理内存，就像在《Ye Olden Times》中那样，这意味着我们也要*释放*内存。

_<u>chunk.h，在 initChunk()方法后添加：</u>_

```c
void initChunk(Chunk* chunk);
// 新增部分开始
void freeChunk(Chunk* chunk);
// 新增部分结束
void writeChunk(Chunk* chunk, uint8_t byte);
```

实现为:

_<u>chunk.c，在 initChunk()方法后添加：</u>_

```c
void freeChunk(Chunk* chunk) {
  FREE_ARRAY(uint8_t, chunk->code, chunk->capacity);
  initChunk(chunk);
}
```

我们释放所有的内存，然后调用`initChunk()`将字段清零，使字节码块处于一个定义明确的空状态。为了释放内存，我们再添加一个宏。

_<u>memory.h，添加代码：</u>_

```c
#define GROW_ARRAY(type, pointer, oldCount, newCount) \
    (type*)reallocate(pointer, sizeof(type) * (oldCount), \
        sizeof(type) * (newCount))
// 新增部分开始
#define FREE_ARRAY(type, pointer, oldCount) \
    reallocate(pointer, sizeof(type) * (oldCount), 0)
// 新增部分结束
void* reallocate(void* pointer, size_t oldSize, size_t newSize);
```

与`GROW_ARRAY()`类似，这是对`reallocate()`调用的包装。这个函数通过传入 0 作为新的内存块大小，来释放内存。我知道，这是一堆无聊的低级别代码。别担心，在后面的章节中，我们会大量使用这些内容。但在此之前，我们必须先打好自己的基础。

## 14.4 反汇编字节码块

现在我们有一个创建字节码块的小模块。让我们手动构建一个样例字节码块来测试一下。

_<u>main.c，在 main()方法中添加：</u>_

```c
int main(int argc, const char* argv[]) {
  // 新增部分开始
  Chunk chunk;
  initChunk(&chunk);
  writeChunk(&chunk, OP_RETURN);
  freeChunk(&chunk);
  // 新增部分结束
  return 0;
```

不要忘了 include。

_<u>main.c，添加代码：</u>_

```c
#include "common.h"
// 新增部分开始
#include "chunk.h"
// 新增部分结束
int main(int argc, const char* argv[]) {
```

试着运行一下，它起作用了吗？额……谁知道呢。我们所做的只是在内存中存入一些字节。我们没有友好的方法来查看我们制作的字节码块中到底有什么。

为了解决这个问题，我们要创建一个**反汇编程序**。**汇编程序**是一个老式程序，它接收一个文件，该文件中包含 CPU 指令（如 "ADD "和 "MULT"）的可读助记符名称，并将它们翻译成等价的二进制机器代码。反汇编程序则相反——给定一串机器码，它会返回指令的文本列表。

我们将实现一个类似的模块。给定一个字节码块，它将打印出其中所有的指令。Lox 用户不会使用它，但我们这些 Lox 的维护者肯定会从中受益，因为它给我们提供了一个了解解释器内部代码表示的窗口。

在`main()`中，我们创建字节码块后，将其传入反汇编器。

_<u>main.c，在 main()方法中添加：</u>_

```c
  initChunk(&chunk);
  writeChunk(&chunk, OP_RETURN);
  // 新增部分开始
  disassembleChunk(&chunk, "test chunk");
  // 新增部分结束
  freeChunk(&chunk);
```

我们又创建了另一个模块。

_<u>main.c，添加代码：</u>_

```c
#include "chunk.h"
// 新增部分开始
#include "debug.h"
// 新增部分结束
int main(int argc, const char* argv[]) {
```

下面是这个头文件：

_<u>debug.h，创建新文件：</u>_

```c
#ifndef clox_debug_h
#define clox_debug_h

#include "chunk.h"

void disassembleChunk(Chunk* chunk, const char* name);
int disassembleInstruction(Chunk* chunk, int offset);

#endif
```

在`main()`方法中，我们调用`disassembleChunk()`来反汇编整个字节码块中的所有指令。这是用另一个函数实现的，该函数只反汇编一条指令。因为我们将在后面的章节中从 VM 中调用它，所以将它添加到头文件中。

下面是简单的实现文件：

_<u>debug.c，创建新文件：</u>_

```c
#include <stdio.h>

#include "debug.h"

void disassembleChunk(Chunk* chunk, const char* name) {
  printf("== %s ==\n", name);

  for (int offset = 0; offset < chunk->count;) {
    offset = disassembleInstruction(chunk, offset);
  }
}
```

要反汇编一个字节码块，我们首先打印一个小标题（这样我们就知道正在看哪个字节码块），然后通过字节码反汇编每个指令。我们遍历代码的方式有点奇怪。我们没有在循环中增加`offset`，而是让`disassembleInstruction()` 为我们做这个。当我们调用该函数时，在对给定偏移量的位置反汇编指令后，会返回*下一条*指令的偏移量。这是因为，我们后面也会看到，指令可以有不同的大小。

“debug”模块的核心是这个函数：

_<u>debug.c，在 disassembleChunk()方法后添加：</u>_

```c
int disassembleInstruction(Chunk* chunk, int offset) {
  printf("%04d ", offset);

  uint8_t instruction = chunk->code[offset];
  switch (instruction) {
    case OP_RETURN:
      return simpleInstruction("OP_RETURN", offset);
    default:
      printf("Unknown opcode %d\n", instruction);
      return offset + 1;
  }
}
```

首先，它会打印给定指令的字节偏移量——这能告诉我们当前指令在字节码块中的位置。当我们在字节码中实现控制流和跳转时，这将是一个有用的路标。

接下来，它从字节码中的给定偏移量处读取一个字节。这也就是我们的操作码。我们根据该值做 switch 操作。对于每一种指令，我们都分派给一个小的工具函数来展示它。如果给定的字节看起来根本不像一条指令——这是我们编译器的一个错误——我们也要打印出来。对于我们目前仅有的一条指令`OP_RETURN`，对应的展示函数是：

_<u>debug.c，在 disassembleChunk()方法后添加：</u>_

```c
static int simpleInstruction(const char* name, int offset) {
  printf("%s\n", name);
  return offset + 1;
}
```

return 指令的内容不多，所以它所做的只是打印操作码的名称，然后返回该指令后的下一个字节偏移量。其它指令会有更多的内容。

如果我们现在运行我们的新解释器，它实际上会打印出来：

```
== test chunk ==
0000 OP_RETURN
```

成功了！这有点像我们代码表示中的“Hello, world!”。我们可以创建一个字节码块，向其中写入一条指令，然后将该指令提取出来。我们对二进制字节码的编码和解码工作正常。

## 14.5 常量

现在我们有了一个基本的块结构，我们来让它变得更有用。我们可以在块中存储*代码*，但是*数据*呢？解释器中使用的很多值都是在运行时作为操作的结果创建的。

```
1 + 2;
```

这里的代码中没有出现 3 这个值。但是，字面量`1`和`2`出现了。为了将该语句编译成字节码，我们需要某种指令，其含义是“生成一个常量”，而这些字母值需要存储在字节码块中的某个地方。在 jlox 中，Expr.Literal 这个 AST 节点中保存了这些值。因为我们没有语法树，现在我们需要一个不同的解决方案。

### 14.5.1 表示值

在本章中我们不会运行任何代码，但是由于常量在解释器的静态和动态世界中都有涉足，这会迫使我们开始思考我们的虚拟机中应该如何表示数值。

现在，我们尽可能从最简单的开始——只支持双精度浮点数。这种表示形式显然会逐渐扩大，所以我们将建立一个新的模块，给自己留出扩展的空间。

_<u>value.h，创建新文件：</u>_

```c
#ifndef clox_value_h
#define clox_value_h

#include "common.h"

typedef double Value;

#endif
```

这个类型定义抽象了 Lox 值在 C 语言中的具体表示方式。这样，我们就可以直接改变表示方法，而不需要回去修改现有的传递值的代码。

回到在字节码块中存储常量的问题。对于像整数这种固定大小的值，许多指令集直接将值存储在操作码之后的代码流中。这些指令被称为**即时指令**，因为值的比特位紧跟在操作码之后。

对于字符串这种较大的或可变大小的常量来说，这并不适用。在本地编译器的机器码中，这些较大的常量会存储在二进制可执行文件中的一个单独的“常量数据”区域。然后，加载常量的指令会有一个地址和偏移量，指向该值在区域中存储的位置。

大多数虚拟机都会做类似的事。例如，Java 虚拟机将常量池与每个编译后的类关联起来。我认为，这对于 clox 来说已经足够了。每个字节码块都会携带一个在程序中以字面量形式出现的值的列表。为简单起见，我们会把所有的常量都放进去，甚至包括简单的整数[^9]。

### 14.5.2 值数组

常量池是一个值的数组。加载常量的指令根据数组中的索引查找该数组中的值。与字节码数组一样，编译器也无法提前知道这个数组需要多大。因此，我们需要一个动态数组。由于 C 语言没有通用数据结构，我们将编写另一个动态数组数据结构，这次存储的是 Value。

_<u>value.h：</u>_

```c
typedef double Value;
// 新增部分开始
typedef struct {
  int capacity;
  int count;
  Value* values;
} ValueArray;
// 新增部分结束
#endif
```

与 Chunk 中的字节码数组一样，这个结构体包装了一个指向数组的指针，以及其分配的容量和已使用元素的数量。我们也需要相同的三个函数来处理值数组。

_<u>value.h，在结构体 ValueArray 后添加：</u>_

```c
} ValueArray;
// 新增部分开始
void initValueArray(ValueArray* array);
void writeValueArray(ValueArray* array, Value value);
void freeValueArray(ValueArray* array);
// 新增部分结束
#endif
```

对应的实现可能会让你有似曾相识的感觉。首先，创建一个新文件：

_<u>value.c，创建一个新文件：</u>_

```c
#include <stdio.h>

#include "memory.h"
#include "value.h"

void initValueArray(ValueArray* array) {
  array->values = NULL;
  array->capacity = 0;
  array->count = 0;
}
```

一旦我们有了初始化的数组，我们就可以开始向其中添加值。

_<u>value.c，在 initValueArray()方法后添加：</u>_

```c
void writeValueArray(ValueArray* array, Value value) {
  if (array->capacity < array->count + 1) {
    int oldCapacity = array->capacity;
    array->capacity = GROW_CAPACITY(oldCapacity);
    array->values = GROW_ARRAY(Value, array->values,
                               oldCapacity, array->capacity);
  }

  array->values[array->count] = value;
  array->count++;
}
```

我们之前写的内存管理宏确实让我们重用了代码数组中的一些逻辑，所以这并不是太糟糕。最后，释放数组所使用的所有内存：

_<u>value.c，在 writeValueArray()方法后添加：</u>_

```c
void freeValueArray(ValueArray* array) {
  FREE_ARRAY(Value, array->values, array->capacity);
  initValueArray(array);
}
```

现在我们有了可增长的值数组，我们可以向 Chunk 中添加一个来保存字节码块中的常量值。

_<u>chunk.h，在结构体 Chunk 中添加：</u>_

```c
  uint8_t* code;
  // 新增部分开始
  ValueArray constants;
  // 新增部分结束
} Chunk;
```

不要忘记 include。

_<u>chunk.h，添加代码：</u>_

```c
#include "common.h"
// 新增部分开始
#include "value.h"
// 新增部分结束
typedef enum {
```

初始化新的字节码块时，我们也要初始化其常量值列表。

_<u>chunk.c，在 initChunk()方法中添加：</u>_

```c
  chunk->code = NULL;
  // 新增部分开始
  initValueArray(&chunk->constants);
  // 新增部分结束
}
```

同样地，我们在释放字节码块时，也需要释放常量值。

_<u>chunk.c，在 freeChunk()方法中添加：</u>_

```c
  FREE_ARRAY(uint8_t, chunk->code, chunk->capacity);
  // 新增部分开始
  freeValueArray(&chunk->constants);
  // 新增部分结束
  initChunk(chunk);
```

接下来，我们定义一个便捷的方法来向字节码块中添加一个新常量。我们尚未编写的编译器可以在 Chunk 内部直接把常量值写入常量数组——它不像 C 语言那样有私有字段之类的东西——但是添加一个显式函数显然会更好一些。

_<u>chunk.h，在 writeChunk()方法后添加：</u>_

```c
void writeChunk(Chunk* chunk, uint8_t byte);
// 新增部分开始
int addConstant(Chunk* chunk, Value value);
// 新增部分结束
#endif
```

然后我们实现它。

_<u>chunk.c，在 writeChunk()方法后添加：</u>_

```c
int addConstant(Chunk* chunk, Value value) {
  writeValueArray(&chunk->constants, value);
  return chunk->constants.count - 1;
}
```

在添加常量之后，我们返回追加常量的索引，以便后续可以定位到相同的常量。

### 14.5.3 常量指令

我们可以将常量存储在字节码块中，但是我们也需要执行它们。在如下这段代码中：

```c
print 1;
print 2;
```

编译后的字节码块不仅需要包含数值 1 和 2，还需要知道何时生成它们，以便按照正确的顺序打印它们。因此，我们需要一种产生特定常数的指令。

_<u>chunk.h，在枚举 OpCode 中添加：</u>_

```c
typedef enum {
  // 新增部分开始
  OP_CONSTANT,
  // 新增部分结束
  OP_RETURN,
```

当 VM 执行常量指令时，它会“加载”常量以供使用[^10]。这个新指令比`OP_RETURN`要更复杂一些。在上面的例子中，我们加载了两个不同的常量。一个简单的操作码不足以知道要加载哪个常量。

为了处理这样的情况，我们的字节码像大多数其它字节码一样，允许指令有**操作数**[^11]。这些操作数以二进制数据的形式存储在指令流的操作码之后，让我们对指令的操作进行参数化。

![OP_CONSTANT is a byte for the opcode followed by a byte for the constant index.](./format.png)

每个操作码会定义它有多少操作数以及各自的含义。例如，一个像“return”这样简单的操作可能没有操作数，而一个“加载局部变量”的指令需要一个操作数来确定要加载哪个变量。每次我们向 clox 添加一个新的操作码时，我们都会指定它的操作数是什么样子的——即它的**指令格式**。

在这种情况下，`OP_CONSTANT`会接受一个单字节的操作数，该操作数指定从块的常量数组中加载哪个常量。由于我们还没有编译器，所以我们在测试字节码块中“手动编译”一个指令。

_<u>main.c，在 main()方法中添加：</u>_

```c
  initChunk(&chunk);
  // 新增部分开始
  int constant = addConstant(&chunk, 1.2);
  writeChunk(&chunk, OP_CONSTANT);
  writeChunk(&chunk, constant);
  // 新增部分结束
  writeChunk(&chunk, OP_RETURN);
```

我们将常量值添加到字节码块的常量池中。这会返回常量在数组中的索引。然后我们写常量操作指令，从操作码开始。之后，我们写入一字节的常量索引操作数。注意， `writeChunk()` 可以写操作码或操作数。对于该函数而言，它们都是原始字节。

如果我们现在尝试运行上面的代码，反汇编器会遇到问题，因为它不知道如何解码新指令。让我们来修复这个问题。

_<u>debug.c，在 disassembleInstruction()方法中添加：</u>_

```c
  switch (instruction) {
    // 新增部分开始
    case OP_CONSTANT:
      return constantInstruction("OP_CONSTANT", chunk, offset);
    // 新增部分结束
    case OP_RETURN:
```

这条指令的格式有所不同，所以我们编写一个新的辅助函数来对其反汇编。

_<u>debug.c，在 disassembleChunk()方法后添加：</u>_

```c
static int constantInstruction(const char* name, Chunk* chunk,
                               int offset) {
  uint8_t constant = chunk->code[offset + 1];
  printf("%-16s %4d '", name, constant);
  printValue(chunk->constants.values[constant]);
  printf("'\n");
}
```

这里要做的事情更多一些。与`OP_ETURN`一样，我们会打印出操作码的名称。然后，我们从该字节码块的后续字节中获取常量索引。我们打印出这个索引值，但是这对于我们人类读者来说并不十分有用。所以，我们也要查找实际的常量值——因为常量毕竟是在编译时就知道的——并将这个值也展示出来。

这就需要一些方法来打印 clox 中的一个 Value。这个函数放在“value”模块中，所以我们要将其 include。

_<u>debug.c，新增代码：</u>_

```c
#include "debug.h"
// 新增部分开始
#include "value.h"
// 新增部分结束
void disassembleChunk(Chunk* chunk, const char* name) {
```

在这个头文件中，我们声明：

_<u>value.h，在 freeValueArray()方法后添加：</u>_

```c
void freeValueArray(ValueArray* array);
// 新增部分开始
void printValue(Value value);
// 新增部分结束
#endif
```

下面是对应的实现：

_<u>value.c，在 freeValueArray()方法后添加：</u>_

```c
void printValue(Value value) {
  printf("%g", value);
}
```

很壮观，是吧？你可以想象，一旦我们在 Lox 中加入动态类型，并且包含了不同类型的值，这部分将会变得更加复杂。

回到`constantInstruction()`中，唯一剩下的部分就是返回值。

_<u>debug.c，在 constantInstruction()方法中添加：</u>_

```c
  printf("'\n");
  // 新增部分开始
  return offset + 2;
  // 新增部分结束
}
```

记住，`disassembleInstruction()`也会返回一个数字，告诉调用方*下一条*指令的起始位置的偏移量。`OP_RETURN`只有一个字节，而`OP_CONSTANT`有两个字节——一个是操作码，一个是操作数。

## 14.6 行信息

字节码块中几乎包含了运行时需要从用户源代码中获取的所有信息。想到我们可以把 jlox 中不同的 AST 类减少到一个字节数组和一个常量数组，这实在有一点疯狂。我们只缺少一个数据。我们需要它，尽管用户希望永远不会看到它。

当运行时错误发生时，我们会向用户显示出错的源代码的行号。在 jlox 中，这些数字保存在词法标记中，而我们又将词法标记存储在 AST 节点中。既然我们已经抛弃了语法树而采用了字节码，我们就需要为 clox 提供不同的解决方案。对于任何字节码指令，我们需要能够确定它是从用户源代码的哪一行编译出来的。

我们有很多聪明的方法可以对此进行编码。我采取了我能想到的绝对最简单的方法，尽管这种方法的内存效率低得令人发指[^12]。在字节码块中，我们存储一个单独的整数数组，该数组与字节码平级。数组中的每个数字都是字节码中对应字节所在的行号。当发生运行时错误时，我们根据当前指令在代码数组中的偏移量查找对应的行号。

为了实现这一点，我们向 Chunk 中添加另一个数组。

_<u>chunk.h， 在结构体 Chunk 中添加：</u>_

```c
  uint8_t* code;
  // 新增部分开始
  int* lines;
  // 新增部分结束
  ValueArray constants;
```

由于它与字节码数组完全平行，我们不需要单独的计数值和容量值。每次我们访问代码数组时，也会对行号数组做相应的修改，从初始化开始。

_<u>chunk.c，在 initChunk()方法中添加：</u>_

```c
  chunk->code = NULL;
  // 新增部分开始
  chunk->lines = NULL;
  // 新增部分结束
  initValueArray(&chunk->constants);
```

回收也是类似的：

_<u>chunk.c，在 freeChunk()中添加：</u>_

```c
  FREE_ARRAY(uint8_t, chunk->code, chunk->capacity);
  // 新增部分开始
  FREE_ARRAY(int, chunk->lines, chunk->capacity);
  // 新增部分结束
  freeValueArray(&chunk->constants);
```

当我们向块中写入一个代码字节时，我们需要知道它来自哪个源代码行，所以我们在`writeChunk()`的声明中添加一个额外的参数。

_<u>chunk.h，在 writeChunk()函数中替换一行：</u>_

```c
void freeChunk(Chunk* chunk);
// 替换部分开始
void writeChunk(Chunk* chunk, uint8_t byte, int line);
// 替换部分结束
int addConstant(Chunk* chunk, Value value);
```

然后在实现中修改：

_<u>chunk.c，在 writeChunk()函数中替换一行：</u>_

```c
// 替换部分开始
void writeChunk(Chunk* chunk, uint8_t byte, int line) {
// 替换部分结束
  if (chunk->capacity < chunk->count + 1) {
```

当我们分配或扩展代码数组时，我们也要对行信息进行相同的处理。

_<u>chunk.c，在 writeChunk()方法中添加：</u>_

```c
    chunk->code = GROW_ARRAY(uint8_t, chunk->code,
        oldCapacity, chunk->capacity);
    // 新增部分开始
    chunk->lines = GROW_ARRAY(int, chunk->lines,
        oldCapacity, chunk->capacity);
    // 新增部分结束
  }
```

最后，我们在数组中保存行信息。

_<u>chunk.c，在 writeChunk()方法中添加：</u>_

```c
  chunk->code[chunk->count] = byte;
  // 新增部分开始
  chunk->lines[chunk->count] = line;
  // 新增部分结束
  chunk->count++;
```

### 14.6.1 反汇编行信息

好吧，让我们手动编译一个小的字节码块测试一下。首先，由于我们向`writeChunk()`添加了一个新参数，我们需要修改一下该方法的调用，向其中添加一些行号（这里可以随意选择行号值）。

> _main.c_，在 _main_()方法中替换四行：

```c
  int constant = addConstant(&chunk, 1.2);
  // 替换部分开始
  writeChunk(&chunk, OP_CONSTANT, 123);
  writeChunk(&chunk, constant, 123);

  writeChunk(&chunk, OP_RETURN, 123);
  // 替换部分结束
  disassembleChunk(&chunk, "test chunk");
```

当然，一旦我们有了真正的前端，编译器会在解析时跟踪当前行，并将其传入字节码中。

现在我们有了每条指令的行信息，让我们好好利用它吧。在我们的反汇编程序中，展示每条指令是由哪一行源代码编译出来的是很有帮助的。当我们试图弄清楚某些字节码应该做什么时，这给我们提供了一种方法来映射回原始代码。在打印了指令的偏移量之后——从字节码块起点到当前指令的字节数——我们也展示它在源代码中的行号。

_<u>debug.c，在 disassembleInstruction()方法中添加：</u>_

```c
int disassembleInstruction(Chunk* chunk, int offset) {
  printf("%04d ", offset);
  // 新增部分开始
  if (offset > 0 &&
      chunk->lines[offset] == chunk->lines[offset - 1]) {
    printf("   | ");
  } else {
    printf("%4d ", chunk->lines[offset]);
  }
  // 新增部分结束
  uint8_t instruction = chunk->code[offset];
```

字节码指令往往是非常细粒度的。一行源代码往往可以编译成一个完整的指令序列。为了更直观地说明这一点，我们在与前一条指令来自同一源码行的指令前面显示一个“|”。我们的手写字节码块的输出结果如下所示：

```
== test chunk ==
0000  123 OP_CONSTANT         0 '1.2'
0002    | OP_RETURN
```

我们有一个三字节的块。前两个字节是一个常量指令，从该块的常量池中加载 1.2。第一个字节是`OP_CONSTANT`字节码，第二个是在常量池中的索引。第三个字节（偏移量为 2）是一个单字节的返回指令。

在接下来的章节中，我们将用更多种类的指令来充实这个结构。但是基本结构已经在这里了，我们现在拥有了所需要的一切，可以在虚拟机运行时完全表示一段可执行的代码。还记得我们在 jlox 中定义的整个 AST 类族吗？在 clox 中，我们把它减少到了三个数组：代码字节数组，常量值数组，以及用于调试的行信息。

这种减少是我们的新解释器比 jlox 更快的一个关键原因。你可以把字节码看作是 AST 的一种紧凑的序列化，并且解释器在执行时按照需要对其反序列化的方式进行了高度优化。在下一章中，我们将会看到虚拟机是如何做到这一点的。

[^1]: 当然，我们的第二个解释器会依赖 C 标准库来实现内存分配等基本功能，而 C 编译器将我们从运行它的底层机器码的细节中解放出来。糟糕的是，该机器码可能是通过芯片上的微码来实现的。而 C 语言的运行时依赖于操作系统来分配内存页。但是，如果要想在你的书架放得下这本书，我们必须在某个地方停下来。
[^2]: 这种计算斐波那契数列的方式效率低得可笑。我们的目的是查看解释器的运行速度，而不是看我们编写的程序有多快。一个做了大量工作的程序，无论是否有意义，都是一个很好的测试用例。
[^3]: “（header）”部分是 Java 虚拟机用来支持内存管理和存储对象类型的记录信息，这些也会占用空间。
[^4]: 情况也没有那么可怕。一个架构良好的编译器，可以让你跨不同的架构共享前端和大部分中间层的优化通道。每次都需要重新编写的主要是代码生成和指令选择的一些细节。[LLVM](https://llvm.org/)项目提供了一些开箱即用的功能。如果你的编译器输出 LLVM 自己特定的中间语言，LLVM 可以反过来将其编译为各种架构的本地代码。
[^5]: 最早的字节码格式之一是 p-code，是为 Niklaus Wirth 的 Pascal 语言开发的。你可能会认为一个运行在 15MHz 的 PDP-11 无法承担模拟虚拟机的开销。但在当时，计算机正处于寒武纪大爆发时期，每天都有新的架构出现。跟上最新的芯片要比从某个芯片中压榨出最大性能更有价值。这就是为什么 p-code 中的“p”指的不是“Pascal”而是“可移植性 Portable”。
[^6]: 增长数组时会复制现有元素，使得追加元素的复杂度看起来像是 O(n)，而不是 O(1)。但是，你只需要在某些追加操作中执行这个操作步骤。大多数时候，已有多余的容量，所以不需要复制。要理解这一点，我们需要进行[摊销分析](https://en.wikipedia.org/wiki/Amortized_analysis)。这表明，只要我们把数组大小增加到当前大小的倍数，当我们把一系列追加操作的成本平均化时，每次追加都是 O(1)。
[^7]: 我在这本书中选择了数字 8，有些随意。大多数动态数组实现都有一个这样的最小阈值。挑选这个值的正确方法是根据实际使用情况进行分析，看看那个常数能在额外增长和浪费的空间之间做出最佳的性能权衡。
[^8]: 既然我们传入的只是一个指向内存第一个字节的裸指针，那么“更新”块的大小意味着什么呢？在内部，内存分配器为堆分配的每个内存块都维护了额外的簿记信息，包括它的大小。给定一个指向先前分配的内存的指针，它就可以找到这个簿记信息，为了能干净地释放内存，这是必需的。`realloc()`所更新的正是这个表示大小的元数据。许多`malloc()`的实现将分配的大小存储在返回地址之前的内存中。
[^9]: 除了需要两种常量指令（一种用于即时值，一种用于常量表中的常量）之外，即时指令还要求我们考虑对齐、填充和字节顺序的问题。如果你尝试在一个奇数地址填充一个 4 字节的整数，有些架构中会出错。
[^10]: 我这里对于“加载”或“产生”一个常量的含义含糊其辞，因为我们还没有学到虚拟机在运行时是如何执行的代码的。关于这一点，你必须等到（或者直接跳到）下一章。
[^11]: 字节码指令的操作数与传递给算术操作符的操作数不同。当我们讲到表达式时，你会看到算术操作数的值是被单独跟踪的。指令操作数是一个较低层次的概念，它可以修改字节码指令本身的行为方式。
[^12]: 这种脑残的编码至少做对了一件事：它将行信息保存一个单独的数组中，而不是将其编入字节码本身中。由于行信息只在运行时出现错误时才使用，我们不希望它在指令之间占用 CPU 缓存中的宝贵空间，而且解释器在跳过行数获取它所关心的操作码和操作数时，会造成更多的缓存丢失。

---

## 习题

1. 我们对行信息的编码非常浪费内存。鉴于一系列指令通常对应于同一源代码行，一个自然的解决方案是对行号进行类似[游程编码](https://en.wikipedia.org/wiki/Run-length_encoding)的操作。

   设计一个编码方式，压缩同一行上一系列指令的行信息。修改`writeChunk()` 以写入该压缩形式，并实现一个`getLine()` 函数，给定一条指令的索引，确定该指令所在的行。

   _提示：`getLine()`不一定要特别高效。因为它只在出现运行时错误时才被调用，所以在它并不是影响性能的关键因素。_

2. 因为`OP_CONSTANT`只使用一个字节作为操作数，所以一个块最多只能包含 256 个不同的常数。这已经够小了，用户在编写真正的代码时很容易会遇到这个限制。我们可以使用两个或更多字节来存储操作数，但这会使*每个*常量指令占用更多的空间。大多数字节码块都不需要那么多独特的常量，所以这就浪费了空间，并牺牲了一些常规情况下的局部性来支持罕见场景。

   为了平衡这两个相互冲突的目标，许多指令集具有多个执行相同操作但操作数大小不同的指令。保留现有的使用一个字节的`OP_CONSTANT`指令，并定义一个新的`OP_CONSTANT_LONG`指令。它将操作数存储为 24 位的数字，这应该就足够了。

   实现该函数：

   ```c
   void writeConstant(Chunk* chunk, Value value, int line) {
     // Implement me...
   }
   ```

   它向`chunk`的常量数组中添加`value`，然后写一条合适的指令来加载常量。同时在反汇编程序中增加对 `OP_CONSTANT_LONG`指令的支持。

   定义两条指令似乎是两全其美的办法。它会迫使我们做出什么牺牲呢（如果有的话）？

3. 我们的`reallocate()`函数依赖于 C 标准库进行动态内存分配和释放。`malloc()` 和 `free()` 并不神奇。找几个它们的开源实现，并解释它们是如何工作的。它们如何跟踪哪些字节被分配，哪些被释放？分配一个内存块需要什么？释放的时候呢？它们如何实现高效？它们如何处理碎片化内存？

   _硬核模式_：在不调用`realloc()`, `malloc()`, 和 `free()`的前提下，实现`reallocate()`。你可以在解释器开始执行时调用一次`malloc()`，来分配一个大的内存块，你的`reallocate()`函数能够访问这个内存块。它可以从这个区域（你自己的私人堆内存）中分配内存块。你的工作就是定义如何做到这一点。

---

## 设计笔记：测试你的语言

我们的书已经过半了，有一件事我们还没有谈及，那就是*测试*你的语言实现。这并不是因为测试不重要。语言实现有一个好的、全面的套件是多么重要，我怎么强调都不为过。

在我写本书之前，我为 Lox 写了一个[测试套件](https://github.com/munificent/craftinginterpreters/tree/master/test)（你也可以在自己的 Lox 实现中使用它）。这些测试在我的语言实现中发现了无数的 bug。

测试在所有软件中都很重要，但对于编程语言来说，测试甚至更重要，至少有以下几个原因：

- **用户希望他们的编程语言能够坚如磐石**。我们已经习惯了成熟的编译器、解释器，以至于“是你的代码（出错了），而不是编译器”成为[软件文化中根深蒂固的一部分](https://blog.codinghorror.com/the-first-rule-of-programming-its-always-your-fault/)。如果你的语言实现中有错误，用户需要经历全部五个痛苦的阶段才能弄清楚发生了什么，而你并不想让他们经历这一切。
- **语言的实现是一个紧密相连的软件**。有些代码库既广泛又浮浅。如果你的文本编辑器中的文件加载代码被破坏了，它不会导致屏幕上的文本渲染失败（希望如此）。语言的实现则更狭窄和深入，特别是处理语言实际语义的解释器核心部分。这使得系统的各个部分之间奇怪的交互会造成微妙的错误。这就需要好的测试来清除这些问题。
- **从设计上来说，语言实现的输入是组合性的**。用户可以写出无限多的程序，而你的实现需要能够正确地运行这些程序。您显然不能进行详尽地测试，但需要努力覆盖尽可能多的输入空间。
- **语言的实现通常是复杂的、不断变化的，而且充满了优化**。这就导致了粗糙代码中有很多隐藏错误的黑暗角落。

所有这些都意味着你需要做大量的测试。但是什么测试呢？我见过的项目主要集中在端到端的“语言测试”上。每个测试都是一段用该语言编写的程序，以及它预期产生的输出或错误。然后，你还需要一个测试运行器，将这些测试程序输入到你的语言实现中，并验证它是否按照预期执行。用语言本身编写测试有一些很好的优势：

- 测试不与任何特定的 API 或语言实现的内部结构相耦合。这样你可以重新组织或重写解释器或编译器的一部分，而不需要更新大量的测试。
- 你可以对该语言的多种实现使用相同的测试。
- 测试通常是简洁的，易于阅读和维护，因为它们只是语言写就的简单脚本。

不过，这并不全是好事：

- 端到端测试可以帮助你确定是否存在错误，但不能确认错误在哪里。在语言实现中找出错误代码的位置可能更加困难，因为测试只能告诉你没有出现正确的输出。
- 要编写一个有效的程序来测试实现中一些不太明显的角落，可能是一件比较麻烦的事。对于高度优化的编译器来说尤其如此，你可能需要编写复杂的代码，以确保最终能够到达正确的优化路径，以测试其中可能隐藏的错误。
- 启动解释器、解析、编译和运行每个测试脚本的开销可能很高。对于一个大的测试套件来说，（如果你确实需要的话，请记住）这可能意味着需要花费很多时间来等待测试的完成。

我可以继续说下去，但是我不希望这变成一场说教。此外，我并不想假装自己是语言测试专家。我只是想让你在内心深处明白，测试你的语言是多么重要。我是认真的。测试你的语言。你会为此感谢我的。
