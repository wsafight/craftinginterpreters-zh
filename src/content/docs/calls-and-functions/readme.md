---
title: 24. 调用和函数
description: Calls and Functions
---

> 计算机科学中的任何问题都可以通过另一个间接层来解决。间接层数过多的问题除外。
>
> ​ —— David Wheeler

这一章是一头猛兽。我试图把功能分解成小块，但有时候你不得不吞下整顿饭。我们的下一个任务是函数。我们可以只从函数声明开始，但是如果你不能调用它们，那就没什么用了。我们可以实现调用，但是也没什么可调用的。而且，为了实现这两个功能所需的所有运行时支持，如果不能与你能直观看到的东西相挂钩，就不是很有价值。所以我们都要做。虽然内容很多，但等我们完成时，我们会感觉很好。

## 24.1 函数对象

虚拟机中最有趣的结构变化是围绕堆栈进行的。我们已经有了用于局部变量和临时变量的栈，所以我们已经完成了一半。但是我们还没有调用堆栈的概念。在我们取得更大进展之前，必须先解决这个问题。但首先，让我们编写一些代码。一旦开始行动，我就感觉好多了。如果没有函数的某种表示形式，我们就做不了太多事，所以我们先从这里开始。从虚拟机的角度来看，什么是函数？

函数有一个可以被执行的主体，也就是一些字节码。我们可以把整个程序和所有的函数声明编译成一个大的字节码块。每个函数都有一个指针指向其在字节码块中的第一条指令。

这大概就是编译为本地代码的工作原理，你最终得到的是一大堆机器码。但是对于我们的字节码虚拟机，我们可以做一些更高层次的事情。我认为一个更简洁的模型是给每个函数它自己的字节码块。我们还需要一些其它的元数据，所以我们现在来把它们塞进一个结构体中。

_<u>object.h，在结构体 Obj 后添加代码：</u>_

```c
  struct Obj* next;
};
// 新增部分开始
typedef struct {
  Obj obj;
  int arity;
  Chunk chunk;
  ObjString* name;
} ObjFunction;
// 新增部分结束
struct ObjString {
```

函数是 Lox 中的一等公民，所以它们需要作为实际的 Lox 对象。因此，ObjFunction 具有所有对象类型共享的 Obj 头。`arity`字段存储了函数所需要的参数数量。然后，除了字节码块，我们还需要存储函数名称。这有助于报告可读的运行时错误[^1]。

这是“object”模块第一次需要引用 Chunk，所以我们需要引入一下。

_<u>object.h，添加代码：</u>_

```c
#include "common.h"
// 新增部分开始
#include "chunk.h"
// 新增部分结束
#include "value.h"
```

就像我们处理字符串一样，我们定义一些辅助程序，使 Lox 函数更容易在 C 语言中使用。有点像穷人版的面向对象。首先，我们会声明一个 C 函数来创建新 Lox 函数。

_<u>object.h，在结构体 ObjString 后添加代码：</u>_

```c
  uint32_t hash;
};
// 新增部分开始
ObjFunction* newFunction();
// 新增部分结束
ObjString* takeString(char* chars, int length);
```

实现如下：

_<u>object.c，在 allocateObject()方法后添加代码：</u>_

```c
ObjFunction* newFunction() {
  ObjFunction* function = ALLOCATE_OBJ(ObjFunction, OBJ_FUNCTION);
  function->arity = 0;
  function->name = NULL;
  initChunk(&function->chunk);
  return function;
}
```

我们使用好朋友`ALLOCATE_OBJ()`来分配内存并初始化对象的头信息，以便虚拟机知道它是什么类型的对象。我们没有像对 ObjString 那样传入参数来初始化函数，而是将函数设置为一种空白状态——零参数、无名称、无代码。这里会在稍后创建函数后被填入数据。

因为有了一个新类型的对象，我们需要在枚举中添加一个新的对象类型。

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
typedef enum {
  // 新增部分开始
  OBJ_FUNCTION,
  // 新增部分结束
  OBJ_STRING,
} ObjType;
```

当我们使用完一个函数对象后，必须将它借用的比特位返还给操作系统。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
  switch (object->type) {
    // 新增部分开始
    case OBJ_FUNCTION: {
      ObjFunction* function = (ObjFunction*)object;
      freeChunk(&function->chunk);
      FREE(ObjFunction, object);
      break;
    }
    // 新增部分结束
    case OBJ_STRING: {
```

这个 switch 语句负责释放 ObjFunction 本身以及它所占用的其它内存。函数拥有自己的字节码块，所以我们调用 Chunk 中类似析构器的函数[^2]。

Lox 允许你打印任何对象，而函数是一等对象，所以我们也需要处理它们。

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
  switch (OBJ_TYPE(value)) {
    // 新增部分开始
    case OBJ_FUNCTION:
      printFunction(AS_FUNCTION(value));
      break;
    // 新增部分结束
    case OBJ_STRING:
```

这就引出了：

_<u>object.c，在 copyString()方法后添加代码：</u>_

```c
static void printFunction(ObjFunction* function) {
  printf("<fn %s>", function->name->chars);
}
```

既然函数知道它的名称，那就应该说出来。

最后，我们有几个宏用于将值转换为函数。首先，确保你的值实际上*是*一个函数。

_<u>object.h，添加代码：</u>_

```c
#define OBJ_TYPE(value)        (AS_OBJ(value)->type)
// 新增部分开始
#define IS_FUNCTION(value)     isObjType(value, OBJ_FUNCTION)
// 新增部分结束
#define IS_STRING(value)       isObjType(value, OBJ_STRING)
```

假设计算结果为真，你就可以使用这个方法将 Value 安全地转换为一个 ObjFunction 指针：

_<u>object.h，添加代码：</u>_

```c
#define IS_STRING(value)       isObjType(value, OBJ_STRING)
// 新增部分开始
#define AS_FUNCTION(value)     ((ObjFunction*)AS_OBJ(value))
// 新增部分结束
#define AS_STRING(value)       ((ObjString*)AS_OBJ(value))
```

这样，我们的对象模型就知道如何表示函数了。我现在感觉已经热身了。你准备好来点更难的东西了吗？

## 24.2 编译为函数对象

现在，我们的编译器假定它总会编译到单个字节码块中。由于每个函数的代码都位于不同的字节码块，这就变得更加复杂了。当编译器碰到函数声明时，需要在编译函数主体时将代码写入函数自己的字节码块中。在函数主体的结尾，编译器需要返回到它之前正处理的前一个字节码块。

这对于函数主体内的代码来说很好，但是对于不在其中的代码呢？Lox 程序的“顶层”也是命令式代码，而且我们需要一个字节码块来编译它。我们也可以将顶层代码放入一个自动定义的函数中，从而简化编译器和虚拟机的工作。这样一来，编译器总是在某种函数主体内，而虚拟机总是通过调用函数来运行代码。这就像整个程序被包裹在一个隐式的`main()`函数中一样[^3]。

在我们讨论用户定义的函数之前，让我们先重新组织一下，支持隐式的顶层函数。这要从 Compiler 结构体开始。它不再直接指向编译器写入的 Chunk，而是指向正在构建的函数对象的引用。

_<u>compiler.c，在结构体 Compiler 中添加代码：</u>_

```c
typedef struct {
  // 新增部分开始
  ObjFunction* function;
  FunctionType type;
  // 新增部分结束
  Local locals[UINT8_COUNT];
```

我们也有一个小小的 FunctionType 枚举。这让编译器可以区分它在编译顶层代码还是函数主体。大多数编译器并不关心这一点——这就是为什么它是一个有用的抽象——但是在一两个地方，这种区分是有意义的。我们稍后会讲到其中一个。

_<u>compiler.c，在结构体 Local 后添加代码：</u>_

```
typedef enum {
  TYPE_FUNCTION,
  TYPE_SCRIPT
} FunctionType;
```

编译器中所有写入 Chunk 的地方，现在都需要通过`function`指针。幸运的是，在很多章节之前，我们在`currentChunk()`函数中封装了对字节码块的访问。我们只需要修改它，编译器的其它部分就可以了[^4]。

_<u>compiler.c，在变量 current 后，替换 5 行：</u>_

```c
Compiler* current = NULL;
// 替换部分开始
static Chunk* currentChunk() {
  return &current->function->chunk;
}
// 替换部分结束
static void errorAt(Token* token, const char* message) {
```

当前的字节码块一定是我们正在编译的函数所拥有的块。接下来，我们需要实际创建该函数。之前，虚拟机将一个 Chunk 传递给编译器，编译器会将代码填入其中。现在取而代之的是，编译器创建并返回一个包含已编译顶层代码的函数——这就是我们目前所支持的。

### 24.2.1 编译时创建函数

我们在`compile()`中开始执行此操作，该方法是进入编译器的主要入口点。

_<u>compiler.c，在 compile()方法中替换 1 行：</u>_

```c
  Compiler compiler;
  // 替换部分开始
  initCompiler(&compiler, TYPE_SCRIPT);
  // 替换部分结束
  parser.hadError = false;
```

在如何初始化编译器方面有很多改变。首先，我们初始化新的 Compiler 字段。

_<u>compiler.c，在函数 initCompiler()中替换 3 行：</u>_

```c
  // 替换部分开始
static void initCompiler(Compiler* compiler, FunctionType type) {
  compiler->function = NULL;
  compiler->type = type;
  // 替换部分结束
  compiler->localCount = 0;
```

然后我们分配一个新的函数对象用于编译。

_<u>compiler.c，在 initCompiler()方法中添加代码[^5]：</u>_

```c
  compiler->scopeDepth = 0;
  // 新增部分开始
  compiler->function = newFunction();
  // 新增部分结束
  current = compiler;
```

在编译器中创建 ObjFunction 可能看起来有点奇怪。函数对象是一个函数的运行时表示，但这里我们是在编译时创建它。我们可以这样想：函数类似于一个字符串或数字字面量。它在编译时和运行时之间形成了一座桥梁。当我们碰到函数*声明*时，它们确实*是*字面量——它们是一种生成内置类型值的符号。因此，编译器在编译期间创建函数对象[^6]。然后，在运行时，它们被简单地调用。

下面是另一段奇怪的代码：

_<u>compiler.c，在 initCompiler()方法中添加代码：</u>_

```c
  current = compiler;
  // 新增部分开始
  Local* local = &current->locals[current->localCount++];
  local->depth = 0;
  local->name.start = "";
  local->name.length = 0;
  // 新增部分结束
}
```

请记住，编译器的`locals`数组记录了哪些栈槽与哪些局部变量或临时变量相关联。从现在开始，编译器隐式地要求栈槽 0 供虚拟机自己内部使用。我们给它一个空的名称，这样用户就不能向一个指向它的标识符写值。等它起作用时，我会解释这是怎么回事。

这就是初始化这一边的工作。当我们完成一些代码的编译时，还需要在另一边做一些改变。

_<u>compiler.c，在函数 endCompiler()中替换 1 行：</u>_

```c
// 替换部分开始
static ObjFunction* endCompiler() {
// 替换部分结束
  emitReturn();
```

以前，当调用`interpret()`方法进入编译器时，会传入一个要写入的 Chunk。现在，编译器自己创建了函数对象，我们返回该函数。我们从当前编译器中这样获取它：

_<u>compiler.c，在 endCompiler()方法中添加代码：</u>_

```c
  emitReturn();
  // 新增部分开始
  ObjFunction* function = current->function;
  // 新增部分结束
#ifdef DEBUG_PRINT_CODE
```

然后这样将其返回给`compile()`：

_<u>compiler.c，在 endCompiler()方法中添加代码：</u>_

```c
#endif
  // 新增部分开始
  return function;
  // 新增部分结束
}
```

现在是对该函数进行另一个调整的好时机。之前，我们添加了一些诊断性代码，让虚拟机转储反汇编的字节码，以便我们可以调试编译器。现在生成的字节码块包含在一个函数中，我们要修复这些代码，使其继续工作。

_compiler.c_，在*endCompiler*()方法中替换 1 行：

```c
#ifdef DEBUG_PRINT_CODE
  if (!parser.hadError) {
    // 替换部分开始
    disassembleChunk(currentChunk(), function->name != NULL
        ? function->name->chars : "<script>");
    // 替换部分结束
  }
#endif
```

注意到这里检查了函数名称是否为`NULL`吗？用户定义的函数有名称，但我们为顶层代码创建的隐式函数却没有，即使在我们自己的诊断代码中，我们也需要优雅地处理这个问题。说到这一点：

_<u>object.c，在 printFunction()方法中添加代码：</u>_

```c
static void printFunction(ObjFunction* function) {
  // 新增部分开始
  if (function->name == NULL) {
    printf("<script>");
    return;
  }
  // 新增部分结束
  printf("<fn %s>", function->name->chars);
```

用户没有办法获取对顶层函数的引用并试图打印它，但我们用来打印整个堆栈的诊断代码`DEBUG_TRACE_EXECUTION`可以而且确实这样做了[^7]。

为了给`compile()`提升一级，我们调整其签名。

_compiler.h_，在函数*compile*()中替换 1 行：

```c
#include "vm.h"
// 替换部分开始
ObjFunction* compile(const char* source);
// 替换部分结束
#endif
```

现在它不再接受字节码块，而是返回一个函数。在实现中：

_<u>compiler.c，在函数 compile()中替换 1 行：</u>_

```c
// 替换部分开始
ObjFunction* compile(const char* source) {
// 替换部分结束
  initScanner(source);
```

最后，我们得到了一些实际的代码。我们把方法的最后部分改成这样：
_<u>compiler.c，在 compile()方法中替换 2 行：</u>_

```c
  while (!match(TOKEN_EOF)) {
    declaration();
  }
  // 替换部分开始
  ObjFunction* function = endCompiler();
  return parser.hadError ? NULL : function;
  // 替换部分结束
}
```

我们从编译器获取函数对象。如果没有编译错误，就返回它。否则，我们通过返回`NULL`表示错误。这样，虚拟机就不会试图执行可能包含无效字节码的函数。

最终，我们会更新`interpret()`来处理`compile()`的新声明，但首先我们要做一些其它的改变。

## 24.3 调用帧

是时候进行一次重大的概念性飞跃了。在我们实现函数声明和调用之前，需要让虚拟机准备好处理它们。我们需要考虑两个主要问题：

### 24.3.1 分配局部变量

编译器为局部变量分配了堆栈槽。当程序中的局部变量集分布在多个函数中时，应该如何操作？

一种选择是将它们完全分开。每个函数在虚拟机堆栈中都有自己的一组专用槽，即使在函数没有被调用的情况下，它也会永远拥有这些槽。整个程序中的每个局部变量在虚拟机中都有自己保留的一小块内存[^8]。

信不信由你，早期的编程语言实现就是这样工作的。第一个 Fortran 编译器为每个变量静态地分配了内存。最显而易见的问题是效率很低。大多数函数不会随时都在被调用，所以一直占用未使用的内存是浪费的。

不过，更根本的问题是递归。通过递归，你可以在同一时刻处于对同一个函数的多次调用“中”。每个函数的局部变量都需要自己的内存。在 jlox 中，我们通过在每次调用函数或进入代码块时为环境动态分配内存来解决这个问题[^9]。在 clox 中，我们不希望在每次调用时都付出这样的性能代价。

相反，我们的解决方案介于 Fortran 的静态分配和 jlox 的动态方法之间。虚拟机中的值栈的工作原理是：局部变量和临时变量的后进先出的行为模式。幸运的是，即使你把函数调用考虑在内，这仍然是正确的。这里有一个例子：

```javascript
fun first() {
  var a = 1;
  second();
  var b = 2;
}

fun second() {
  var c = 3;
  var d = 4;
}

first();
```

逐步执行程序，看看在每个时间点上内存中有哪些变量：

![Tracing through the execution of the previous program, showing the stack of variables at each step.](./calls.png)

在这两次调用的执行过程中，每个局部变量都遵循这样的原则：当某个变量需要被丢弃时，在它之后声明的任何变量都会被丢弃。甚至在不同的调用中也是如此。我们知道，在我们用完`a`之前，已经用完了`c`和`d`。看起来我们应该能够在虚拟机的值栈上分配局部变量。

理想情况下，我们仍然在编译时确定每个变量在栈中的位置。这使得处理变量的字节码指令变得简单而快速。在上面的例子中，我们可以想象[^10]以一种直接的方式这样做，但这并不总是可行的。考虑一下：

```
fun first() {
  var a = 1;
  second();
  var b = 2;
  second();
}

fun second() {
  var c = 3;
  var d = 4;
}

first();
```

在对`second()`的第一次调用中，`c`和`d`将进入槽 1 和 2。但在第二次调用中，我们需要为`b`腾出空间，所以`c`和`d`需要放在槽 2 和 3 里。因此，编译器不能在不同的函数调用中为每个局部变量指定一个确切的槽。但是在特定的函数中，每个局部变量的相对位置是固定的。变量`d`总是在变量`c`后面的槽里。这是关键的见解。

当函数被调用时，我们不知道栈顶在什么位置，因为它可以从不同的上下文中被调用。但是，无论栈顶在哪里，我们都知道该函数的所有局部变量相对于起始点的位置。因此，像很多问题一样，我们使用一个中间层来解决分配问题。

在每次函数调用开始时，虚拟机都会记录函数自身的局部变量开始的第一个槽的位置。使用局部变量的指令通过相对于该槽的索引来访问它们，而不是像现在这样使用相对于栈底的索引。在编译时，我们可以计算出这些相对槽位。在运行时，加上函数调用时的起始槽位，就能将相对位置转换为栈中的绝对索引。

这就好像是函数在更大的堆栈中得到了一个“窗口”或“帧”，它可以在其中存储局部变量。**调用帧**的位置是在运行时确定的，但在该区域内部及其相对位置上，我们知道在哪里可以找到目标。

![The stack at the two points when second() is called, with a window hovering over each one showing the pair of stack slots used by the function.](./window.png)

这个记录了函数局部变量开始的位置的历史名称是**帧指针**，因为它指向函数调用帧的开始处。有时你会听到**基指针**，因为它指向一个基本栈槽，函数的所有变量都在其之上。

这是我们需要跟踪的第一块数据。每次我们调用函数时，虚拟机都会确定该函数变量开始的第一个栈槽。

### 24.3.2 返回地址

现在，虚拟机通过递增`ip`字段的方式在指令流中工作。唯一有趣的行为是关于控制流指令的，这些指令会以较大的数值对`ip`进行偏移。调用函数非常直接——将`ip`简单地设置为指向函数块中的第一条指令。但是等函数完成后怎么办？

虚拟机需要返回到调用函数的字节码块，并在调用之后立即恢复执行指令。因此，对于每个函数调用，在调用完成后，需要记录调用完成后需要跳回什么地方。这被称为**返回地址**，因为它是虚拟机在调用后返回的指令的地址。

同样，由于递归的存在，一个函数可能会对应多个返回地址，所以这是每个调用的属性，而不是函数本身的属性[^11]。

### 24.3.3 调用栈

因此，对于每个活动的函数执行（每个尚未返回的调用），我们需要跟踪该函数的局部变量在堆栈中的何处开始，以及调用方应该在何处恢复。我们会将这些信息以及其它一些数据放在新的结构体中。

_<u>vm.h，添加代码：</u>_

```c
#define STACK_MAX 256
// 新增部分开始
typedef struct {
  ObjFunction* function;
  uint8_t* ip;
  Value* slots;
} CallFrame;
// 新增部分结束
typedef struct {
```

一个 CallFrame 代表一个正在进行的函数调用。`slots`字段指向虚拟机的值栈中该函数可以使用的第一个槽。我给它取了一个复数的名字是因为我们会把它当作一个数组来对待（感谢 C 语言中“指针是一种数组”这个奇怪的概念）。

返回地址的实现与我上面的描述有所不同。调用者不是将返回地址存储在被调用者的帧中，而是将自己的`ip`存储起来。等到从函数中返回时，虚拟机会跳转到调用方的 CallFrame 的`ip`，并从那里继续执行。

我还在这里塞了一个指向被调用函数的指针。我们会用它来查询常量和其它一些事情。

每次函数被调用时，我们会创建一个这样的结构体。我们可以在堆上动态地分配它们，但那样会很慢。函数调用是核心操作，所以它们需要尽可能快。幸运的是，我们意识到它和变量很相似：函数调用具有堆栈语义。如果`first()`调用`second()`，对`second()`的调用将在`first()`之前完成[^12]。

因此在虚拟机中，我们预先创建一个 CallFrame 结构体的数组，并将其作为堆栈对待，就像我们对值数组所做的那样。

_<u>vm.h，在结构体 VM 中替换 2 行：</u>_

```c
typedef struct {
  // 替换部分开始
  CallFrame frames[FRAMES_MAX];
  int frameCount;
  // 替换部分结束
  Value stack[STACK_MAX];
```

这个数组取代了我们过去在 VM 中直接使用的`chunk`和`ip`字段。现在，每个 CallFrame 都有自己的`ip`和指向它正在执行的 ObjFunction 的指针。通过它们，我们可以得到函数的字节码块。

VM 中新的`frameCount`字段存储了 CallFrame 栈的当前高度——正在进行的函数调用的数量。为了使 clox 简单，数组的容量是固定的。这意味着，和许多语言的实现一样，存在一个我们可以处理的最大调用深度。对于 clox，在这里定义它：

_<u>vm.h，替换 1 行：</u>_

```c
#include "value.h"
// 替换部分开始
#define FRAMES_MAX 64
#define STACK_MAX (FRAMES_MAX * UINT8_COUNT)
// 替换部分结束
typedef struct {
```

我们还以此重新定义了值栈的大小，以确保即使在很深的调用树中我们也有足够的栈槽[^13]。当虚拟机启动时，CallFrame 栈是空的。

_<u>vm.c，在 resetStack()方法中添加代码：</u>_

```c
  vm.stackTop = vm.stack;
  // 新增部分开始
  vm.frameCount = 0;
  // 新增部分结束
}
```

“vm.h”头文件需要访问 ObjFunction，所以我们加一个引入。

_<u>vm.h，替换 1 行：</u>_

```c
#define clox_vm_h
// 替换部分开始
#include "object.h"
// 替换部分结束
#include "table.h"
```

现在我们准备转移到 VM 的实现文件中。我们还有很多艰巨的工作要做。我们已经将`ip`从 VM 结构体移到了 CallFrame 中。我们需要修改 VM 中使用了`ip`的每一行代码来解决这个问题。此外，需要更新根据栈槽访问局部变量的指令，使其相对于当前 CallFrame 的`slots`字段进行访问。

我们从最上面开始，彻底解决这个问题。

_<u>vm.c，在 run()方法中替换 4 行：</u>_

```c
static InterpretResult run() {
  // 替换部分开始
  CallFrame* frame = &vm.frames[vm.frameCount - 1];

#define READ_BYTE() (*frame->ip++)

#define READ_SHORT() \
    (frame->ip += 2, \
    (uint16_t)((frame->ip[-2] << 8) | frame->ip[-1]))

#define READ_CONSTANT() \
    (frame->function->chunk.constants.values[READ_BYTE()])
// 替换部分结束
#define READ_STRING() AS_STRING(READ_CONSTANT())
```

首先，我们将当前最顶部的 CallFrame 存储在主字节码执行函数中的一个局部变量中。然后我们将字节码访问宏替换为通过该变量访问`ip`的版本[^14]。

现在我们来看看每条需要温柔呵护的指令。

_<u>vm.c，在 run()方法中替换 1 行：</u>_

```c
      case OP_GET_LOCAL: {
        uint8_t slot = READ_BYTE();
        // 替换部分开始
        push(frame->slots[slot]);
        // 替换部分结束
        break;
```

以前，`OP_GET_LOCAL`直接从虚拟机的栈数组中读取给定的局部变量槽，这意味着它是从栈底开始对槽进行索引。现在，它访问的是当前帧的`slots`数组，这意味着它是访问相对于该帧起始位置的给定编号的槽。

设置局部变量的方法也是如此。

_<u>vm.c，在 run()方法中替换 1 行：</u>_

```c
      case OP_SET_LOCAL: {
        uint8_t slot = READ_BYTE();
        // 替换部分开始
        frame->slots[slot] = peek(0);
        // 替换部分结束
        break;
```

跳转指令之前是修改 VM 的`ip`字段。现在，它会对当前帧的`ip`做相同的操作。

_<u>vm.c，在 run()方法中替换 1 行：</u>_

```c
      case OP_JUMP: {
        uint16_t offset = READ_SHORT();
        // 替换部分开始
        frame->ip += offset;
        // 替换部分结束
        break;
```

条件跳转也是如此：

_<u>vm.c，在 run()方法中替换 1 行：</u>_

```c
      case OP_JUMP_IF_FALSE: {
        uint16_t offset = READ_SHORT();
        // 替换部分开始
        if (isFalsey(peek(0))) frame->ip += offset;
        // 替换部分结束
        break;
```

还有向后跳转的循环指令：

_<u>vm.c，在 run()方法中替换 1 行：</u>_

```c
      case OP_LOOP: {
        uint16_t offset = READ_SHORT();
        // 替换部分开始
        frame->ip -= offset;
        // 替换部分结束
        break;
```

我们还有一些诊断代码，可以在每条指令执行时将其打印出来，帮助我们调试虚拟机。这也需要能处理新的结构体。

_<u>vm.c，在 run()方法中替换 2 行：</u>_

```c
    printf("\n");
    // 替换部分开始
    disassembleInstruction(&frame->function->chunk,
        (int)(frame->ip - frame->function->chunk.code));
    // 替换部分结束
#endif
```

现在我们从当前的 CallFrame 中读取数据，而不是传入 VM 的`chunk` 和`ip` 字段。

其实，这不算太糟。大多数指令只是使用了宏，所以不需要修改。接下来，我们向上跳到调用`run()`的代码。

_<u>vm.c，在 interpret() 方法中替换 10 行：</u>_

```c
InterpretResult interpret(const char* source) {
  // 替换部分开始
  ObjFunction* function = compile(source);
  if (function == NULL) return INTERPRET_COMPILE_ERROR;

  push(OBJ_VAL(function));
  CallFrame* frame = &vm.frames[vm.frameCount++];
  frame->function = function;
  frame->ip = function->chunk.code;
  frame->slots = vm.stack;
  // 替换部分结束
  InterpretResult result = run();
```

我们终于可以将之前的编译器修改与我们刚刚做的后端更改联系起来。首先，我们将源代码传递给编译器。它返回给我们一个新的 ObjFunction，其中包含编译好的顶层代码。如果我们得到的是`NULL`，这意味着存在一些编译时错误，编译器已经报告过了。在这种情况下，我们就退出，因为我们没有可以运行的代码。

否则，我们将函数存储在堆栈中，并准备一个初始 CallFrame 来执行其代码。现在你可以看到为什么编译器将栈槽 0 留出来——其中存储着正在被调用的函数。在新的 CallFrame 中，我们指向该函数，将`ip`初始化为函数字节码的起始位置，并将堆栈窗口设置为从 VM 值栈的最底部开始。

这样解释器就准备好开始执行代码了。完成后，虚拟机原本会释放硬编码的字节码块。现在 ObjFunction 持有那段代码，我们就不需要再这样做了，所以`interpret()`的结尾是这样的：

_<u>vm.c，在 interpret()方法中替换 4 行：</u>_

```c
  frame->slots = vm.stack;
  // 替换部分开始
  return run();
  // 替换部分结束
}
```

最后一段引用旧的 VM 字段的代码是`runtimeError()`。我们会在本章后面重新讨论这个问题，但现在我们先将它改成这样：

_<u>vm.c，在 runtimeError()方法中替换 2 行：</u>_

```c
  fputs("\n", stderr);
  // 替换部分开始
  CallFrame* frame = &vm.frames[vm.frameCount - 1];
  size_t instruction = frame->ip - frame->function->chunk.code - 1;
  int line = frame->function->chunk.lines[instruction];
  // 替换部分结束
  fprintf(stderr, "[line %d] in script\n", line);
```

它不是直接从 VM 中读取字节码块和`ip`，而是从栈顶的 CallFrame 中获取这些信息。这应该能让函数重新工作，并且表现像以前一样。

假如我们都正确执行了所有这些操作，就可以让 clox 回到可运行的状态。启动它，它就会……像以前一样。我们还没有添加任何新功能，所以这有点让人失望。但是所有的基础设施都已经就绪了。让我们好好利用它。

## 24.4 函数声明

在我们确实可以调用表达式之前，首先需要一些可以用来调用的东西，所以我们首先要处理函数声明。一切从关键字开始。【译者注：作者这里使用了一个小小的双关，实在不好翻译】

_<u>compiler.c，在 declaration()方法中替换 1 行：</u>_

```c
static void declaration() {
  // 替换部分开始
  if (match(TOKEN_FUN)) {
    funDeclaration();
  } else if (match(TOKEN_VAR)) {
  // 替换部分结束
    varDeclaration();
```

它将控制权传递到这里：

_<u>compiler.c，在 block()方法后添加：</u>_

```c
static void funDeclaration() {
  uint8_t global = parseVariable("Expect function name.");
  markInitialized();
  function(TYPE_FUNCTION);
  defineVariable(global);
}
```

函数是一等公民，函数声明只是在新声明的变量中创建并存储一个函数。因此，我们像其它变量声明一样解析名称。顶层的函数声明会将函数绑定到一个全局变量。在代码块或其它函数内部，函数声明会创建一个局部变量。

在前面的章节中，我解释了变量是如何分两个阶段定义的。这确保了你不能在变量自己的初始化器中访问该变量的值。这很糟糕，因为变量还*没有*值。

函数不会遇到这个问题。函数在其主体内引用自己的名称是安全的。在函数被完全定义之后，你才能调用函数并执行函数体，所以你永远不会看到处于未初始化状态的变量。实际上，为了支持递归局部函数，允许这样做是很有用的。

为此，在我们编译函数名称时（编译函数主体之前），就将函数声明的变量标记为“已初始化”。这样就可以在主体中引用该名称，而不会产生错误。

不过，我们确实需要做一个检查。

_<u>compiler.c，在 markInitialized()方法中添加代码：</u>_

```c
static void markInitialized() {
  // 新增部分开始
  if (current->scopeDepth == 0) return;
  // 新增部分结束
  current->locals[current->localCount - 1].depth =
```

以前，只有在已经知道当前处于局部作用域中时，我们才会调用`markInitialized()`。现在，顶层的函数声明也会调用这个函数。当这种情况发生时，没有局部变量需要标记为已初始化——函数被绑定到了一个全局变量。

接下来，我们编译函数本身——它的参数列表和代码块主体。为此，我们使用一个单独的辅助函数。该函数生成的代码会将生成的函数对象留在栈顶。之后，我们调用`defineVariable()`，将该函数存储到我们为其声明的变量中。

我将编译参数和主体的代码分开，因为我们稍后会重用它来解析类中的方法声明。我们来逐步构建它，从这里开始：

_<u>compiler.c，在 block()方法后添加代码[^15]：</u>_

```c
static void function(FunctionType type) {
  Compiler compiler;
  initCompiler(&compiler, type);
  beginScope();

  consume(TOKEN_LEFT_PAREN, "Expect '(' after function name.");
  consume(TOKEN_RIGHT_PAREN, "Expect ')' after parameters.");
  consume(TOKEN_LEFT_BRACE, "Expect '{' before function body.");
  block();

  ObjFunction* function = endCompiler();
  emitBytes(OP_CONSTANT, makeConstant(OBJ_VAL(function)));
}
```

现在，我们不需要考虑参数。我们解析一对空括号，然后是主体。主体以左大括号开始，我们在这里会解析它。然后我们调用现有的`block()`函数，该函数知道如何编译代码块的其余部分，包括结尾的右大括号。

### 24.4.1 编译器栈

有趣的部分是顶部和底部的编译器。Compiler 结构体存储的数据包括哪些栈槽被哪些局部变量拥有，目前处于多少层的嵌套块中，等等。所有这些都是针对单个函数的。但是现在，前端需要处理编译相互嵌套的多个函数的编译[^16]。

管理这个问题的诀窍是为每个正在编译的函数创建一个单独的 Compiler。当我们开始编译函数声明时，会在 C 语言栈中创建一个新的 Compiler 并初始化它。`initCompiler()`将该 Compiler 设置为当前编译器。然后，在编译主体时，所有产生字节码的函数都写入新 Compiler 的函数所持有的字节码块。

在我们到达函数主体块的末尾时，会调用`endCompiler()`。这就得到了新编译的函数对象，我们将其作为常量存储在*外围*函数的常量表中。但是，等等。我们怎样才能回到外围的函数中呢？在`initCompiler()`覆盖当前编译器指针时，我们把它丢了。

我们通过将一系列嵌套的 Compiler 结构体视为一个栈来解决这个问题。与 VM 中的 Value 和 CallFrame 栈不同，我们不会使用数组。相反，我们使用链表。每个 Compiler 都指向包含它的函数的 Compiler，一直到顶层代码的根 Compiler。

_<u>compiler.c，在枚举 FunctionType 后替换 1 行：</u>_

```c
} FunctionType;
// 替换部分开始
typedef struct Compiler {
  struct Compiler* enclosing;
  // 替换部分结束
  ObjFunction* function;
```

在 Compiler 结构体内部，我们不能引用 Compiler*类型定义*，因为声明还没有结束。相反，我们要为结构体本身提供一个名称，并将其用作字段的类型。C 语言真奇怪。

在初始化一个新的 Compiler 时，我们捕获即将更换的当前编译器。

_<u>compiler.c，在 initCompiler()方法中添加代码：</u>_

```c
static void initCompiler(Compiler* compiler, FunctionType type) {
  // 新增部分开始
  compiler->enclosing = current;
  // 新增部分结束
  compiler->function = NULL;
```

然后，当编译器完成时，将之前的编译器恢复为新的当前编译器，从而将自己从栈中弹出。

_<u>compiler.c，在 endCompiler()方法中添加代码：</u>_

```c
#endif
  // 新增部分开始
  current = current->enclosing;
  // 新增部分结束
  return function;
```

请注意，我们甚至不需要动态地分配 Compiler 结构体。每个结构体都作为局部变量存储在 C 语言栈中——不是`compile()`就是`function()`。编译器链表在 C 语言栈中存在。我们之所以能得到无限多的编译器[^17]，是因为我们的编译器使用了递归下降，所以当有嵌套的函数声明时，`function()`最终会递归地调用自己。

### 24.4.2 函数参数

如果你不能向函数传递参数，那函数就不是很有用，所以接下来我们实现参数。

_<u>compiler.c，在 function()方法中添加代码：</u>_

```c
  consume(TOKEN_LEFT_PAREN, "Expect '(' after function name.");
  // 新增部分开始
  if (!check(TOKEN_RIGHT_PAREN)) {
    do {
      current->function->arity++;
      if (current->function->arity > 255) {
        errorAtCurrent("Can't have more than 255 parameters.");
      }
      uint8_t constant = parseVariable("Expect parameter name.");
      defineVariable(constant);
    } while (match(TOKEN_COMMA));
  }
  // 新增部分结束
  consume(TOKEN_RIGHT_PAREN, "Expect ')' after parameters.");
```

语义上讲，形参就是在函数体最外层的词法作用域中声明的一个局部变量。我们可以使用现有的编译器对声明命名局部变量的支持来解析和编译形参。与有初始化器的局部变量不同，这里没有代码来初始化形参的值。稍后在函数调用中传递参数时，我们会看到它们是如何初始化的。

在此过程中，我们通过计算所解析的参数数量来确定函数的元数。函数中存储的另一个元数据是它的名称。在编译函数声明时，我们在解析完函数名称之后，会立即调用`initCompiler()`。这意味着我们可以立即从上一个标识中获取名称。

_<u>compiler.c，在 initCompiler()方法中添加代码：</u>_

```c
  current = compiler;
  // 新增部分开始
  if (type != TYPE_SCRIPT) {current->function->name = copyString(parser.previous.start, parser.previous.length);
  }
  // 新增部分结束
  Local* local = &current->locals[current->localCount++];
```

请注意，我们谨慎地创建了名称字符串的副本。请记住，词素直接指向了源代码字符串。一旦代码编译完成，该字符串就可能被释放。我们在编译器中创建的函数对象比编译器的寿命更长，并持续到运行时。所以它需要自己的堆分配的名称字符串，以便随时可用。

太棒了。现在我们可以编译函数声明了，像这样：

```javascript
fun areWeHavingItYet() {
  print "Yes we are!";
}

print areWeHavingItYet;
```

只是我们还不能用它们来做任何有用的事情。

## 24.5 函数调用

在本小节结束时，我们将开始看到一些有趣的行为。下一步是调用函数。我们通常不会这样想，但是函数调用表达式有点像是一个中缀`(`操作符。在左边有一个高优先级的表达式，表示被调用的内容——通常只是一个标识符。然后是中间的`(`，后跟由逗号分隔的参数表达式，最后是一个`)`把它包起来。

这个奇怪的语法视角解释了如何将语法挂接到我们的解析表格中。

_<u>compiler.c，在 unary()方法后添加，替换 1 行：</u>_

```c
ParseRule rules[] = {
  // 替换部分开始
  [TOKEN_LEFT_PAREN]    = {grouping, call,   PREC_CALL},
  // 替换部分结束
  [TOKEN_RIGHT_PAREN]   = {NULL,     NULL,   PREC_NONE},
```

当解析器遇到表达式后面的左括号时，会将其分派到一个新的解析器函数。

_<u>compiler.c，在 binary()方法后添加代码：</u>_

```c
static void call(bool canAssign) {
  uint8_t argCount = argumentList();
  emitBytes(OP_CALL, argCount);
}
```

我们已经消费了`(`标识，所以接下来我们用一个单独的`argumentList()`辅助函数来编译参数。该函数会返回它所编译的参数的数量。每个参数表达式都会生成代码，将其值留在栈中，为调用做准备。之后，我们发出一条新的`OP_CALL`指令来调用该函数，将参数数量作为操作数。

我们使用这个助手来编译参数：

_<u>compiler.c，在 defineVariable()方法后添加代码：</u>_

```c
static uint8_t argumentList() {
  uint8_t argCount = 0;
  if (!check(TOKEN_RIGHT_PAREN)) {
    do {
      expression();
      argCount++;
    } while (match(TOKEN_COMMA));
  }
  consume(TOKEN_RIGHT_PAREN, "Expect ')' after arguments.");
  return argCount;
}
```

这段代码看起来跟 jlox 很相似。只要我们在每个表达式后面找到逗号，就会仔细分析函数。一旦运行完成，消耗最后的右括号，我们就完成了。

嗯，大概就这样。在 jlox 中，我们添加了一个编译时检查，即一次调用传递的参数不超过 255 个。当时，我说这是因为 clox 需要类似的限制。现在你可以明白为什么了——因为我们把参数数量作为单字节操作数填充到字节码中，所以最多只能达到 255。我们也需要在这个编译器中验证。

_<u>compiler.c，在 argumentList()方法中添加代码：</u>_

```c
      expression();
      // 新增部分开始
      if (argCount == 255) {
        error("Can't have more than 255 arguments.");
      }
      // 新增部分结束
      argCount++;
```

这就是前端。让我们跳到后端继续，不过要在中间快速暂停一下，声明一个新指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_LOOP,
  // 新增部分开始
  OP_CALL,
  // 新增部分结束
  OP_RETURN,
```

### 24.5.1 绑定形参与实参

在我们开始实现之前，应该考虑一下堆栈在调用时是什么样子的，以及我们需要从中做什么。当我们到达调用指令时，我们已经执行了被调用函数的表达式，后面是其参数。假设我们的程序是这样的：

```javascript
fun sum(a, b, c) {
  return a + b + c;
}

print 4 + sum(5, 6, 7);
```

如果我们在调用`sum()`的`OP_CALL`指令处暂停虚拟机，栈看起来是这样的：

![Stack: 4, fn sum, 5, 6, 7.](./argument-stack.png)

从`sum()`本身的角度来考虑这个问题。当编译器编译`sum()`时，它自动分配了槽位 0。然后，它在该位置后为参数`a`、`b`、`c`依次分配了局部槽。为了执行对`sum()`的调用，我们需要一个通过被调用函数和可用栈槽区域初始化的 CallFrame。然后我们需要收集传递给函数的参数，并将它们放入参数对应的槽中。

当 VM 开始执行`sum()`函数体时，我们需要栈窗口看起来像这样：

![The same stack with the sum() function's call frame window surrounding fn sum, 5, 6, and 7.](./parameter-window.png)

你是否注意到，调用者设置的实参槽和被调用者需要的形参槽的顺序是完全匹配的？多么方便啊！这并非巧合。当我谈到每个 CallFrame 在栈中都有自己的窗口时，从未说过这些窗口一定是不相交的。没有什么能阻止我们将它们重叠起来，就像这样：

![The same stack with the top-level call frame covering the entire stack and the sum() function's call frame window surrounding fn sum, 5, 6, and 7.](http://www.craftinginterpreters.com/image/calls-and-functions/overlapping-windows.png)

调用者栈的顶部包括被调用的函数，后面依次是参数。我们知道调用者在这些正在使用的槽位之上没有占用其它槽，因为在计算参数表达式时需要的所有临时变量都已经被丢弃了。被调用者栈的底部是重叠的，这样形参的槽位与已有的实参值的位置就完全一致[^18]。

这意味着我们不需要做*任何*工作来“将形参绑定到实参”。不用在槽之间或跨环境复制值。这些实参已经在它们需要在的位置了。很难有比这更好的性能了。

是时候来实现调用指令了。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_CALL: {
        int argCount = READ_BYTE();
        if (!callValue(peek(argCount), argCount)) {
          return INTERPRET_RUNTIME_ERROR;
        }
        break;
      }
      // 新增部分结束
      case OP_RETURN: {
```

我们需要知道被调用的函数以及传递给它的参数数量。我们从指令的操作数中得到后者。它还告诉我们，从栈顶向下跳过参数数量的槽位，就可以在栈中找到该函数。我们将这些数据传给一个单独的`callValue()`函数。如果函数返回`false`，意味着该调用引发了某种运行时错误。当这种情况发生时，我们中止解释器。

如果`callValue()`成功，将会在 CallFrame 栈中为被调用函数创建一个新帧。`run()`函数有它自己缓存的指向当前帧的指针，所以我们需要更新它。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
          return INTERPRET_RUNTIME_ERROR;
        }
        // 新增部分开始
        frame = &vm.frames[vm.frameCount - 1];
        // 新增部分结束
        break;
```

因为字节码调度循环会从`frame`变量中读取数据，当 VM 执行下一条指令时，它会从新的被调用函数 CallFrame 中读取`ip`，并跳转到其代码处。执行该调用的工作从这里开始：

_<u>vm.c，在 peek()方法后添加代码[^19]：</u>_

```c
static bool callValue(Value callee, int argCount) {
  if (IS_OBJ(callee)) {
    switch (OBJ_TYPE(callee)) {
      case OBJ_FUNCTION:
        return call(AS_FUNCTION(callee), argCount);
      default:
        break; // Non-callable object type.
    }
  }
  runtimeError("Can only call functions and classes.");
  return false;
}
```

这里要做的不仅仅是初始化一个新的 CallFrame，因为 Lox 是动态类型的，所以没有什么可以防止用户编写这样的糟糕代码：

```javascript
var notAFunction = 123;
notAFunction();
```

如果发生这种情况，运行时需要安全报告错误并停止。所以我们要做的第一件事就是检查我们要调用的值的类型。如果不是函数，我们就报错退出。否则，真正的调用就发生在这里：

_<u>vm.c，在 peek()方法后添加代码：</u>_

```c
static bool call(ObjFunction* function, int argCount) {
  CallFrame* frame = &vm.frames[vm.frameCount++];
  frame->function = function;
  frame->ip = function->chunk.code;
  frame->slots = vm.stackTop - argCount - 1;
  return true;
}
```

这里只是初始化了栈上的下一个 CallFrame。其中存储了一个指向被调用函数的指针，并将调用帧的`ip`指向函数字节码的开始处。最后，它设置`slots`指针，告诉调用帧它在栈上的窗口位置。这里的算法可以确保栈中已存在的实参与函数的形参是对齐的。

![The arithmetic to calculate frame->slots from stackTop and argCount.](./arithmetic.png)

这个有趣的`-1`是为了处理栈槽 0，编译器留出了这个槽，以便稍后添加方法时使用。形参从栈槽 1 开始，所以我们让窗口提前一个槽开始，以使它们与实参对齐。

在我们更进一步之前，让我们把新指令添加到反汇编程序中。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return jumpInstruction("OP_LOOP", -1, chunk, offset);
    // 新增部分开始
    case OP_CALL:
      return byteInstruction("OP_CALL", chunk, offset);
    // 新增部分结束
    case OP_RETURN:
```

还有一个快速的小改动。现在我们有一个方便的函数用来初始化 CallFrame，我们不妨用它来设置用于执行顶层代码的第一个帧。

_<u>vm.c，在 interpret()方法中替换 4 行：</u>_

```c
  push(OBJ_VAL(function));
  // 替换部分开始
  call(function, 0);
  // 替换部分结束
  return run();
```

好了，现在回到调用……

### 24.5.2 运行时错误检查

重叠的栈窗口的工作基于这样一个假设：一次调用中正好为函数的每个形参传入一个实参。但是，同样的，由于 Lox 不是静态类型的，某个愚蠢的用户可以会传入太多或太少的参数。在 Lox 中，我们将其定义为运行时错误，并像这样报告：

_<u>vm.c，在 call()方法中添加代码：</u>_

```c
static bool call(ObjFunction* function, int argCount) {
  // 新增部分开始
  if (argCount != function->arity) {
    runtimeError("Expected %d arguments but got %d.",
        function->arity, argCount);
    return false;
  }
  // 新增部分结束
  CallFrame* frame = &vm.frames[vm.frameCount++];
```

非常简单直接。这就是为什么我们要在 ObjFunction 中存储每个函数的元数。

还有一个需要报告的错误，与其说是用户的愚蠢行为，不如说是我们自己的愚蠢行为。因为 CallFrame 数组具有固定的大小，我们需要确保一个深的调用链不会溢出。

_<u>vm.c，在 call()方法中添加代码：</u>_

```c
  }
  // 新增部分开始
  if (vm.frameCount == FRAMES_MAX) {
    runtimeError("Stack overflow.");
    return false;
  }
  // 新增部分结束
  CallFrame* frame = &vm.frames[vm.frameCount++];
```

在实践中，如果一个程序接近这个极限，那么很可能在某些失控的递归代码中出现了错误。

### 24.5.3 打印栈跟踪记录

既然我们在讨论运行时错误，那我们就花一点时间让它们变得更有用。在出现运行时错误时停止很重要，可以防止虚拟机以某种不明确的方式崩溃。但是简单的中止并不能帮助用户修复导致错误的代码。

帮助调试运行时故障的经典工具是**堆栈跟踪**——打印出程序死亡时仍在执行的每个函数，以及程序死亡时执行的位置。现在我们有了一个调度栈，并且方便地存储了每个函数的名称。当运行时错误破坏了用户的和谐时，我们可以显示整个堆栈。它看起来像这样：

_<u>vm.c，在 runtimeError()方法中替换 4 行[^20]：</u>_

```c
  fputs("\n", stderr);
  // 替换部分开始
  for (int i = vm.frameCount - 1; i >= 0; i--) {
    CallFrame* frame = &vm.frames[i];
    ObjFunction* function = frame->function;
    size_t instruction = frame->ip - function->chunk.code - 1;
    fprintf(stderr, "[line %d] in ",
            function->chunk.lines[instruction]);
    if (function->name == NULL) {
      fprintf(stderr, "script\n");
    } else {
      fprintf(stderr, "%s()\n", function->name->chars);
    }
  }
  // 替换部分结束
  resetStack();
}
```

在打印完错误信息本身之后，我们从顶部（最近调用的函数）到底部（顶层代码）遍历调用栈[^21]。对于每个调用帧，我们找到与该帧的函数内的当前`ip`相对应的行号。然后我们将该行号与函数名称一起打印出来。

举例来说，如果你运行这个坏掉的程序：

```c
fun a() { b(); }
fun b() { c(); }
fun c() {
  c("too", "many");
}

a();
```

它会打印：

```
Expected 0 arguments but got 2.
[line 4] in c()
[line 2] in b()
[line 1] in a()
[line 7] in script
```

看起来还不错，是吧？

### 24.5.4 从函数中返回

我们快完成了。我们可以调用函数，而虚拟机会执行它们。但是我们还不能从函数中返回。我们支持`OP_RETURN`指令已经有一段时间了，但其中一直有一些临时代码，只是为了让我们脱离字节码循环。现在是真正实现它的时候了。

_<u>vm.c，在 run()方法中替换 2 行：</u>_

```c
      case OP_RETURN: {
        // 替换部分开始
        Value result = pop();
        vm.frameCount--;
        if (vm.frameCount == 0) {
          pop();
          return INTERPRET_OK;
        }

        vm.stackTop = frame->slots;
        push(result);
        frame = &vm.frames[vm.frameCount - 1];
        break;
        // 替换部分结束
      }
```

当函数返回一个值时，该值会在栈顶。我们将会丢弃被调用函数的整个堆栈窗口，因此我们将返回值弹出栈并保留它。然后我们丢弃 CallFrame，从函数中返回。如果是最后一个 CallFrame，这意味着我们已经完成了顶层代码的执行。整个程序已经完成，所以我们从堆栈中弹出主脚本函数，然后退出解释器。

否则，我们会丢弃所有被调用者用于存储参数和局部变量的栈槽，其中包括调用者用来传递实参的相同的槽。现在调用已经完成，调用者不再需要它们了。这意味着栈顶的结束位置正好在返回函数的栈窗口的开头。

我们把返回值压回堆栈，放在新的、较低的位置。然后我们更新`run`函数中缓存的指针，将其指向当前帧。就像我们开始调用一样，在字节码调度循环的下一次迭代中，VM 会从该帧中读取`ip`，执行程序会跳回调用者，就在它离开的地方，紧挨着`OP_CALL`指令之后。

![Each step of the return process: popping the return value, discarding the call frame, pushing the return value.](./return.png)

请注意，我们这里假设函数确实返回了一个值，但是函数可以在到达主体末尾时隐式返回：

```c
fun noReturn() {
  print "Do stuff";
  // No return here.
}

print noReturn(); // ???
```

我们也需要正确地处理这个问题。在这种情况下，语言被指定为隐式返回`nil`。为了实现这一点，我们添加了以下内容：

_<u>compiler.c，在 emitReturn()方法中添加代码：</u>_

```c
static void emitReturn() {
  // 新增部分开始
  emitByte(OP_NIL);
  // 新增部分结束
  emitByte(OP_RETURN);
}
```

编译器调用`emitReturn()`，在函数体的末尾写入`OP_RETURN`指令。现在，在此之前，它会生成一条指令将`nil`压入栈中。这样，我们就有了可行的函数调用！它们甚至可以接受参数！看起来我们好像知道自己在做什么。

## 24.6 Return 语句

如果你想让某个函数返回一些数据，而不是隐式的`nil`，你就需要一个`return`语句。我们来完成它。

_<u>compiler.c，在 statement()方法中添加代码：</u>_

```c
    ifStatement();
  // 新增部分开始
  } else if (match(TOKEN_RETURN)) {
    returnStatement();
  // 新增部分结束
  } else if (match(TOKEN_WHILE)) {
```

当编译器看到`return`关键字时，会进入这里：

_<u>compiler.c，在 printStatement()方法后添加代码：</u>_

```c
static void returnStatement() {
  if (match(TOKEN_SEMICOLON)) {
    emitReturn();
  } else {
    expression();
    consume(TOKEN_SEMICOLON, "Expect ';' after return value.");
    emitByte(OP_RETURN);
  }
}
```

返回值表达式是可选的，因此解析器会寻找分号标识来判断是否提供了返回值。如果没有返回值，语句会隐式地返回`nil`。我们通过调用`emitReturn()`来实现，该函数会生成一个`OP_NIL`指令。否则，我们编译返回值表达式，并用`OP_RETURN`指令将其返回。

这与我们已经实现的`OP_RETURN`指令相同——我们不需要任何新的运行时代码。这与 jlox 有很大的不同。在 jlox 中，当执行`return`语句时，我们必须使用异常来跳出堆栈。这是因为你可以从某些嵌套的代码块深处返回。因为 jlox 递归地遍历 AST。这意味着我们需要从一堆 Java 方法调用中退出。

我们的字节码编译器把这些都扁平化了。我们在解析时进行递归下降，但在运行时，虚拟机的字节码调度循环是完全扁平的。在 C 语言级别上根本没有发生递归。因此，即使从一些嵌套代码块中返回，也和从函数体的末端返回一样简单。

不过，我们还没有完全完成。新的`return`语句为我们带来了一个新的编译错误。return 语句从函数中返回是很有用的，但是 Lox 程序的顶层代码也是命令式代码。你不能从那里返回[^22]。

```c
return "What?!";
```

我们已经规定，在任何函数之外有`return`语句都是编译错误，我们这样实现：

_<u>compiler.c，在 returnStatement()方法中添加代码：</u>_

```c
static void returnStatement() {
  // 新增部分开始
  if (current->type == TYPE_SCRIPT) {
    error("Can't return from top-level code.");
  }
  // 新增部分结束
  if (match(TOKEN_SEMICOLON)) {
```

这是我们在编译器中添加 FunctionType 枚举的原因之一。

## 24.7 本地函数

我们的虚拟机越来越强大。我们已经支持了函数、调用、参数、返回。你可以定义许多不同的函数，它们可以以有趣的方式相互调用。但是，最终，它们什么都做不了。不管 Lox 程序有多复杂，它唯一能做的用户可见的事情就是打印。为了添加更多的功能，我们需要将函数暴露给用户。

编程语言的实现通过**本地函数**向外延伸并接触物质世界。如果你想编写检查时间、读取用户输入或访问文件系统的程序，则需要添加本地函数——可以从 Lox 调用，但是使用 C 语言实现——来暴露这些能力。

在语言层面，Lox 是相当完整的——它支持闭包、类、继承和其它有趣的东西。它之所以给人一种玩具语言的感觉，是因为它几乎没有原生功能。我们可以通过添加一系列功能将其变成一种真正的语言。

然而，辛辛苦苦地完成一堆操作系统的操作，实际上并没有什么教育意义。只要你看到如何将一段 C 代码与 Lox 绑定，你就会明白了。但你确实需要看到一个例子，即使只是一个本地函数，我们也需要构建将 Lox 与 C 语言对接的所有机制。所以我们将详细讨论这个问题并完成所有困难的工作。等这些工作完成之后，我们会添加一个小小的本地函数，以证明它是可行的。

我们需要新机制的原因是，从实现的角度来看，本地函数与 Lox 函数不同。当它们被调用时，它们不会压入一个 CallFrame，因为没有这个帧要指向的字节码。它们没有字节码块。相反，它们会以某种方式引用一段本地 C 代码。

在 clox 中，我们通过将本地函数定义为一个完全不同的对象类型来处理这个问题。

_<u>object.h，在结构体 ObjFunction 后添加代码：</u>_

```c
} ObjFunction;
// 新增部分开始
typedef Value (*NativeFn)(int argCount, Value* args);

typedef struct {
  Obj obj;
  NativeFn function;
} ObjNative;
// 新增部分结束
struct ObjString {
```

其表示形式比 ObjFunction 更简单——仅仅是一个 Obj 头和一个指向实现本地行为的 C 函数的指针。该本地函数接受参数数量和指向栈中第一个参数的指针。它通过该指针访问参数。一旦执行完成，它就返回结果值。

一如既往，一个新的对象类型会带有一些附属品。为了创建 ObjNative，我们声明一个类似构造器的函数。

_<u>object.h，在 newFunction()方法后添加代码：</u>_

```c
ObjFunction* newFunction();
// 新增部分开始
ObjNative* newNative(NativeFn function);
// 新增部分结束
ObjString* takeString(char* chars, int length);
```

我们这样实现它：

_<u>object.c，在 newFunction()方法后添加代码：</u>_

```c
ObjNative* newNative(NativeFn function) {
  ObjNative* native = ALLOCATE_OBJ(ObjNative, OBJ_NATIVE);
  native->function = function;
  return native;
}
```

该构造函数接受一个 C 函数指针，并将其包装在 ObjNative 中。它会设置对象头并保存传入的函数。至于对象头，我们需要一个新的对象类型。

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
typedef enum {
  OBJ_FUNCTION,
  // 新增部分结束
  OBJ_NATIVE,
  // 新增部分开始
  OBJ_STRING,
} ObjType;
```

虚拟机也需要知道如何释放本地函数对象。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
    }
    // 新增部分开始
    case OBJ_NATIVE:
      FREE(ObjNative, object);
      break;
    // 新增部分结束
    case OBJ_STRING: {
```

因为 ObjNative 并没有占用任何额外的内存，所以这里没有太多要做的。所有 Lox 对象需要支持的另一个功能是能够被打印。

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
      break;
    // 新增部分开始
    case OBJ_NATIVE:
      printf("<native fn>");
      break;
    // 新增部分结束
    case OBJ_STRING:
```

为了支持动态类型，我们用一个宏来检查某个值是否本地函数。

_<u>object.h，添加代码：</u>_

```c
#define IS_FUNCTION(value)     isObjType(value, OBJ_FUNCTION)
// 新增部分开始
#define IS_NATIVE(value)       isObjType(value, OBJ_NATIVE)
// 新增部分结束
#define IS_STRING(value)       isObjType(value, OBJ_STRING)
```

如果返回值为真，下面这个宏可以从一个代表本地函数的 Value 中提取 C 函数指针：

_<u>object.h，添加代码：</u>_

```c
#define AS_FUNCTION(value)     ((ObjFunction*)AS_OBJ(value))
// 新增部分开始
#define AS_NATIVE(value) \
    (((ObjNative*)AS_OBJ(value))->function)
// 新增部分结束
#define AS_STRING(value)       ((ObjString*)AS_OBJ(value))
```

所有这些使得虚拟机可以像对待其它对象一样对待本地函数。你可以将它们存储在变量中，传递它们，给它们举办生日派对，等等。当然，我们真正关心的是*调用*它们——将一个本地函数作为调用表达式的左操作数。

在 `callValue()`中，我们添加另一个类型的 case 分支。

_<u>vm.c，在 callValue()方法中添加代码：</u>_

```c
      case OBJ_FUNCTION:
        return call(AS_FUNCTION(callee), argCount);
      // 新增部分开始
      case OBJ_NATIVE: {
        NativeFn native = AS_NATIVE(callee);
        Value result = native(argCount, vm.stackTop - argCount);
        vm.stackTop -= argCount + 1;
        push(result);
        return true;
      }
      // 新增部分结束
      default:
```

如果被调用的对象是一个本地函数，我们就会立即调用 C 函数。没有必要使用 CallFrames 或其它任何东西。我们只需要交给 C 语言，得到结果，然后把结果塞回栈中。这使得本地函数的运行速度能够尽可能快。

有了这个，用户应该能够调用本地函数了，但是还没有任何函数可供调用。如果没有外部函数接口之类的东西，用户就不能定义自己的本地函数。这就是我们作为虚拟机实现者的工作。我们将从一个辅助函数开始，定义一个新的本地函数暴露给 Lox 程序。

_<u>vm.c，在 runtimeError()方法后添加代码：</u>_

```c
static void defineNative(const char* name, NativeFn function) {
  push(OBJ_VAL(copyString(name, (int)strlen(name))));
  push(OBJ_VAL(newNative(function)));
  tableSet(&vm.globals, AS_STRING(vm.stack[0]), vm.stack[1]);
  pop();
  pop();
}
```

它接受一个指向 C 函数的指针及其在 Lox 中的名称。我们将函数包装在 ObjNative 中，然后将其存储在一个带有指定名称的全局变量中。

你可能像知道为什么我们要在栈中压入和弹出名称与函数。看起来很奇怪，是吧？当涉及到垃圾回收时，你必须考虑这类问题。`copyString()`和`newNative()`都是动态分配内存的。这意味着一旦我们有了 GC，它们就有可能触发一次收集。如果发生这种情况，我们需要确保收集器知道我们还没有用完名称和 ObjFunction ，这样垃圾回收就不会将这些数据从我们手下释放出来。将它们存储在值栈中可以做到这一点[^23]。

这感觉很傻，但是在完成所有这些工作之后，我们只会添加一个小小的本地函数。

_<u>vm.c，在变量 vm 后添加代码：</u>_

```c
static Value clockNative(int argCount, Value* args) {
  return NUMBER_VAL((double)clock() / CLOCKS_PER_SEC);
}
```

该函数会返回程序开始运行以来经过的时间，单位是秒。它对 Lox 程序的基准测试很有帮助。在 Lox 中，我们将其命名为`clock()`。

_<u>vm.c，在 initVM()方法中添加代码：</u>_

```c
  initTable(&vm.strings);
  // 新增部分开始
  defineNative("clock", clockNative);
  // 新增部分结束
}
```

为了获得 C 语言标准库中的`clock()`函数，`vm`模块需要引入头文件。

_<u>vm.c，添加代码：</u>_

```c
#include <string.h>
// 新增部分开始
#include <time.h>
// 新增部分结束
#include "common.h"
```

这部分有很多内容要处理，但是我们做到了！输入这段代码试试：

```
fun fib(n) {
  if (n < 2) return n;
  return fib(n - 2) + fib(n - 1);
}

var start = clock();
print fib(35);
print clock() - start;
```

我们已经可以编写一个非常低效的递归斐波那契函数。更妙的是，我们可以测量它有多低效。当然，这不是计算斐波那契数的最聪明的方法，但这是一个针对语言实现对函数调用的支持进行压力测试的好方法。在我的机器上，clox 中运行这个程序大约比 jlox 快 5 倍。这是个相当大的提升[^24]。

[^1]: 人们似乎并不觉得数值型的字节码偏移量在崩溃转储中特别有意义。
[^2]: 我们不需要显式地释放函数名称，因为它是一个 ObjString。这意味着我们可以让垃圾收集器为我们管理它的生命周期。或者说，至少在实现垃圾收集器之后，我们就可以这样做了。
[^3]: 这种类比在语义上有个行不通的地方就是全局变量。它们具有与局部变量不同的特殊作用域规则，因此从这个角度来说，脚本的顶层并不像一个函数体。
[^4]: 这就像我有一个可以看到未来的水晶球，知道我们以后需要修改代码。但是，实际上，这是因为我在写文字之前已经写了本书中的所有代码。
[^5]: 我知道，让`function`字段为空，但在几行之后又立即为其赋值，这看起来很蠢。更像是与垃圾回收有关的偏执。
[^6]: 我们可以在编译时创建函数，是因为它们只包含编译时可用的数据。函数的代码、名称和元都是固定的。等我们在下一章中添加闭包时（在运行时捕获变量），情况就变得更加复杂了。
[^7]: 如果我们用来寻找 bug 的诊断代码本身导致虚拟机发生故障，那就不好玩了。
[^8]: 这基本就是你在 C 语言中使用`static`声明每个局部变量的结果。
[^9]: Fortran 完全不允许递归，从而避免了这个问题。递归在当时被认为是一种高级、深奥的特性。
[^10]: 我说“想象”是因为编译器实际上无法弄清这一点。因为函数在 Lox 中是一等公民，我们无法在编译时确定哪些函数调用了哪些函数。
[^11]: 早期 Fortran 编译器的作者在实现返回地址方面有一个巧妙的技巧。由于它们*不*支持递归，任何给定的函数在任何时间点都只需要一个返回地址。因此，当函数在运行时被调用时，程序会修改自己的代码，更改函数末尾的跳转指针，以跳回调用方。有时候，天才和疯子之间只有一线之隔。
[^12]: 许多 Lisp 实现都是动态地分配堆栈帧的，因为它简化实现了[续延](https://en.wikipedia.org/wiki/Continuation)。如果你的语言支持续延，那么函数调用并不一定具有堆栈语义。
[^13]: 如果除了局部变量之外，还有足够多的临时变量，仍然有可能溢出堆栈。一个健壮的实现可以防止这种情况，但我想尽量保持简单。
[^14]: 我们可以通过每次查看 CallFrame 数组来访问当前帧，但这太繁琐了。更重要的是，将帧存储在一个局部变量中，可以促使 C 编译器将该指针保存在一个寄存器中。这样就能加快对帧中`ip`的访问。我们不能保证编译器会这样做，但很有可能会这样做。
[^15]: 这里的`beginScope()`并没有对应的`endScope()`调用。因为当达到函数体的末尾时，我们会完全结束整个 Compiler，所以没必要关闭逗留的最外层作用域。
[^16]: 请记住，编译器将顶层代码视为隐式函数的主体，因此只要添加任何函数声明，我们就会进入一个嵌套函数的世界。
[^17]: 使用本地堆栈存储编译器结构体确实意味着我们的编译器对函数声明的嵌套深度有一个实际限制。如果嵌套太多，可能会导致 C 语言堆栈溢出。如果我们想让编译器能够更健壮地抵御错误甚至恶意的代码（这是 JavaScript 虚拟机等工具真正关心的问题），那么最好是人为地让编译器限制所允许的函数嵌套层级。
[^18]: 不同的字节码虚拟机和真实的 CPU 架构有不同的调用约定，也就是它们传递参数、存储返回地址等的具体机制。我在这里使用的机制是基于 Lua 干净、快速的虚拟机。
[^19]: 使用`switch`语句来检查一个类型现在看有些多余，但当我们添加 case 来处理其它调用类型时，就有意义了。
[^20]: 这里的`-1`是因为 IP 已经指向了下一条待执行的指令上 ，但我们希望堆栈跟踪指向前一条失败的指令。
[^21]: 关于栈帧在跟踪信息中显示的顺序，存在一些不同的意见。大部分把最内部的函数放在第一行，然后向堆栈的底部。Python 则以相反的顺序打印出来。因此，从上到下阅读可以告诉你程序是如何达到现在的位置的，而最后一行是错误实际发生的地方。<BR>这种风格有一个逻辑。它可以确保你始终可以看到最里面的函数，即使堆栈跟踪信息太长而无法在一个屏幕上显示。另一方面，新闻业中的“[倒金字塔](<https://en.wikipedia.org/wiki/Inverted_pyramid_(journalism)>)”告诉我们，我们应该把最重要的信息放在一段文字的前面。在堆栈跟踪中，这就是实际发生错误的函数。大多数其它语言的实现都是如此。
[^22]: 允许在顶层返回并不是世界上最糟糕的主意。它可以为你提供一种自然的方式来提前终止脚本。你甚至可以用返回的数字来表示进程的退出码。
[^23]: 如果你没搞懂也不用担心，一旦我们开始实现 GC，它就会变得更有意义。
[^24]: 它比在 Ruby 2.4.3p205 中运行的同类 Ruby 程序稍慢，比在 Python 3.7.3 中运行的程序快 3 倍左右。而且我们仍然可以在我们的虚拟机中做很多简单的优化。

---

## 习题

1. 读写`ip`字段是字节码循环中最频繁的操作之一。新增，我们通过一个指向当前 CallFrame 的指针来访问它。这里需要一次指针间接引用，可能会迫使 CPU 绕过缓存而进入主存。这可能是一个真正的性能损耗。

   理想情况下，我们一个将`ip`保存在一个本地 CPU 寄存器中。在不引入内联汇编的情况下，C 语言中不允许我们这样做，但是我们可以通过结构化的代码来鼓励编译器进行优化。如果我们将`ip`直接存储在 C 局部变量中，并将其标记为`register`，那么 C 编译器很可能会同意我们的礼貌请求。

   这确实意味着在开始和结束函数调用时，我们需要谨慎地从正确的 CallFrame 中加载和保存局部变量`ip`。请实现这一优化。写几个基准测试，看看它对性能有什么影响。您认为增加的代码复杂性值得吗？

2. 本地函数调用之所以快，部分原因是我们没有验证调用时传入的参数是否与期望的一样多。我们确实应该这样做，否则在没有足够参数的情况下错误地调用本地函数，会导致函数读取未初始化的内存空间。请添加参数数量检查。

3. 目前，本机函数还没有办法发出运行时错误的信号。在一个真正的语言实现中，这是我们需要支持的，因为本机函数存在于静态类型的 C 语言世界中，却被动态类型的 Lox 调用。假如说，用户试图向`sqrt()`传递一个字符串，则该本地函数需要报告一个运行时错误。

   扩展本地函数系统，以支持该功能。这个功能会如何影响本地调用的性能？

4. 添加一些本地函数来做你认为有用的事情。用它们写一些程序。你添加了什么？它们是如何影响语言的感觉和实用性的？
