---
title: 25. 闭包
description: Closures
---

> 正如那人所说，每一个复杂的问题都有一个简单的解决方案，但这个解决方案是错误的。
>
> ​ —— Umberto Eco, _Foucault’s Pendulum_

感谢我们在[上一章](../../calls-and-functions/readme)的辛勤劳动，我们得到了一个拥有函数的虚拟机。现在虚拟机缺失的是闭包。除了全局变量（也就是函数的同类）之外，函数没有办法引用其函数体之外声明的变量。

```javascript
var x = "global";
fun outer() {
  var x = "outer";
  fun inner() {
    print x;
  }
  inner();
}
outer();
```

现在运行这个示例，它打印的是“global”。但它应该打印“outer”。为了解决这个问题，我们需要在解析变量时涵盖所有外围函数的整个词法作用域。

这个问题在 clox 中比在 jlox 中更难解决，因为我们的字节码虚拟机将局部变量存储在栈中。我们使用堆栈是因为，我声称局部变量具有栈语义——变量被丢弃的顺序与创建的顺序正好相反。但对于闭包来说，这只在大部分情况下是正确的。

```javascript
fun makeClosure() {
  var local = "local";
  fun closure() {
    print local;
  }
  return closure;
}

var closure = makeClosure();
closure();
```

外层函数`makeClosure()`声明了一个变量`local`。它还创建了一个内层函数`closure()`，用于捕获该变量。然后`makeClosure()`返回对该内层函数的引用。因为闭包要在保留局部变量的同时进行退出，所以`local`必须比创建它的函数调用存活更长的时间。

![A local variable flying away from the stack.](./flying.png)

我们可以通过为所有局部变量动态地分配内存来解决这个问题。这就是 jlox 所做的，它将所有对象都放在 Java 堆中漂浮的 Environment 对象中。但我们并不想这样做。使用堆栈*非常*快。大多数局部变量都不会被闭包捕获，并且具有栈语义。如果为了极少数被捕获的局部变量而使所有变量的速度变慢，那就糟糕了[^1]。

这意味着一种比我们在 Java 解释器中所用的更复杂的方法。因为有些局部变量具有非常不同的生命周期，我们将有两种实现策略。对于那些不在闭包中使用的局部变量，我们将保持它们在栈中的原样。当某个局部变量被闭包捕获时，我们将采用另一种解决方案，将它们提升到堆中，在那里它们存活多久都可以。

闭包早在 Lisp 时代就已经存在了，当时内存字节和 CPU 周期比祖母绿还要珍贵。在过去的几十年里，黑客们设计了各种各样的方式来编译闭包，以优化运行时表示[^2]。有些方法更有效，但也需要更复杂的编译过程，我们无法轻易地在 clox 中加以改造。

我在这里解释的技术来自于 Lua 虚拟机的设计。它速度快，内存占用少，并且只用相对较少的代码就实现了。更令人印象深刻的是，它很自然地适用于 clox 和 Lua 都在使用的单遍编译器。不过，它有些复杂，可能需要一段时间才能把所有的碎片在你的脑海中拼凑起来。我们将一步一步地构建它们，我将尝试分阶段介绍这些概念。

## 25.1 闭包对象

我们的虚拟机在运行时使用 ObjFunction 表示函数。这些对象是由前端在编译时创建的。在运行时，虚拟机所做的就是从一个常量表中加载函数对象，并将其与一个名称绑定。在运行时，没有“创建”函数的操作。与字符串和数字字面量一样，它们是纯粹在编译时实例化的常量[^3]。

这是有道理的，因为组成函数的所有数据在编译时都是已知的：根据函数主体编译的字节码块，以及函数主体中使用的常量。一旦我们引入闭包，这种表示形式就不够了。请看一下：

```javascript
fun makeClosure(value) {
  fun closure() {
    print value;
  }
  return closure;
}

var doughnut = makeClosure("doughnut");
var bagel = makeClosure("bagel");
doughnut();
bagel();
```

`makeClosure()`函数会定义并返回一个函数。我们调用它两次，得到两个闭包。它们都是由相同的嵌套函数声明`closure`创建的，但关闭在不同的值上。当我们调用这两个闭包时，每个闭包都打印出不同的字符串。这意味着我们需要一些闭包运行时表示，以捕获函数外围的局部变量，因为这些变量要在函数声明被*执行*时存在，而不仅仅是在编译时存在。

我们会逐步来捕获变量，但良好的第一步是定义对象表示形式。我们现有的 ObjFunction 类型表示了函数声明的“原始”编译时状态，因为从同一个声明中创建的所有闭包都共享相同的代码和常量。在运行时，当我们执行函数声明时，我们将 ObjFunction 包装进一个新的 ObjClosure 结构体中。后者有一个对底层裸函数的引用，以及该函数关闭的变量的运行时状态[^4]。

![An ObjClosure with a reference to an ObjFunction.](./obj-closure.png)

我们将用 ObjClosure 包装每个函数，即使该函数实际上并没有关闭或捕获任何外围局部变量。这有点浪费，但它简化了虚拟机，因为我们总是可以认为我们正在调用的函数是一个 ObjClosure。这个新结构体是这样开始的：

_<u>object.h，在结构体 ObjString 后添加代码：</u>_

```c
typedef struct {
  Obj obj;
  ObjFunction* function;
} ObjClosure;
```

现在，它只是简单地指向一个 ObjFunction，并添加了必要的对象头内容。遵循向 clox 中添加新对象类型的常规步骤，我们声明一个 C 函数来创建新闭包。

_<u>object.h，在结构体 ObjClosure 后添加代码：</u>_

```c
ObjFunction
// 新增部分开始
ObjClosure* newClosure(ObjFunction* function);
// 新增部分结束
ObjFunction* newFunction();
```

然后我们在这里实现它：

_<u>object.c，在 allocateObject()方法后添加代码：</u>_

```c
ObjClosure* newClosure(ObjFunction* function) {
  ObjClosure* closure = ALLOCATE_OBJ(ObjClosure, OBJ_CLOSURE);
  closure->function = function;
  return closure;
}
```

它接受一个指向待包装 ObjFunction 的指针。它还将类型字段初始为一个新类型。

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
typedef enum {
  // 新增部分开始
  OBJ_CLOSURE,
  // 新增部分结束
  OBJ_FUNCTION,
```

以及，当我们用完闭包后，要释放其内存。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
  switch (object->type) {
    // 新增部分开始
    case OBJ_CLOSURE: {
      FREE(ObjClosure, object);
      break;
    }
    // 新增部分结束
    case OBJ_FUNCTION: {
```

我们只释放 ObjClosure 本身，而不释放 ObjFunction。这是因为闭包不*拥有*函数。可能会有多个闭包都引用了同一个函数，但没有一个闭包声称对该函数有任何特殊的权限。我们不能释放某个 ObjFunction，直到引用它的*所有*对象全部消失——甚至包括那些常量表中包含该函数的外围函数。要跟踪这个信息听起来很棘手，事实也的确如此！这就是我们很快就会写一个垃圾收集器来管理它们的原因。

我们还有用于检查值类型的常用宏[^5]。

_<u>object.h，添加代码：</u>_

```c
#define OBJ_TYPE(value)        (AS_OBJ(value)->type)
// 新增部分开始
#define IS_CLOSURE(value)      isObjType(value, OBJ_CLOSURE)
// 新增部分结束
#define IS_FUNCTION(value)     isObjType(value, OBJ_FUNCTION)
```

还有值转换：

_<u>object.h，添加代码：</u>_

```c
#define IS_STRING(value)       isObjType(value, OBJ_STRING)
// 新增部分开始
#define AS_CLOSURE(value)      ((ObjClosure*)AS_OBJ(value))
// 新增部分结束
#define AS_FUNCTION(value)     ((ObjFunction*)AS_OBJ(value))
```

闭包是第一类对象，因此你可以打印它们。

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
  switch (OBJ_TYPE(value)) {
    // 新增部分开始
    case OBJ_CLOSURE:
      printFunction(AS_CLOSURE(value)->function);
      break;
    // 新增部分结束
    case OBJ_FUNCTION:
```

它们的显示和 ObjFunction 一样。从用户的角度来看，ObjFunction 和 ObjClosure 之间的区别纯粹是一个隐藏的实现细节。有了这些，我们就有了一个可用但空白的闭包表示形式。

### 25.1.1 编译为闭包对象

我们有了闭包对象，但是我们的 VM 还从未创建它们。下一步就是让编译器发出指令，告诉运行时何时创建一个新的 ObjClosure 来包装指定的 ObjFunction。这就发生在函数声明的末尾。

_<u>compiler.c，在 function()方法中替换 1 行：</u>_

```c
  ObjFunction* function = endCompiler();
  // 替换部分开始
  emitBytes(OP_CLOSURE, makeConstant(OBJ_VAL(function)));
  // 替换部分结束
}
```

之前，函数声明的最后一个字节码是一条`OP_CONSTANT`指令，用于从外围函数的常量表中加载已编译的函数，并将其压入堆栈。现在我们有了一个新指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_CALL,
  // 新增部分开始
  OP_CLOSURE,
  // 新增部分结束
  OP_RETURN,
```

和`OP_CONSTANT`一样，它接受一个操作数，表示函数在常量表中的索引。但是等到进入运行时实现时，我们会做一些更有趣的事情。

首先，让我们做一个勤奋的虚拟机黑客，为该指令添加反汇编器支持。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
    case OP_CALL:
      return byteInstruction("OP_CALL", chunk, offset);
    // 新增部分开始
    case OP_CLOSURE: {
      offset++;
      uint8_t constant = chunk->code[offset++];
      printf("%-16s %4d ", "OP_CLOSURE", constant);
      printValue(chunk->constants.values[constant]);
      printf("\n");
      return offset;
    }
    // 新增部分结束
    case OP_RETURN:
```

这里做的事情比我们通常在反汇编程序中看到的要多。在本章结束时，你会发现`OP_CLOSURE`是一个相当不寻常的指令。它现在很简单——只有一个单字节的操作数——但我们会增加它的内容。这里的代码预示了未来。

### 25.1.2 解释函数声明

我们需要做的大部分工作是在运行时。我们必须处理新的指令，这是自然的。但是我们也需要触及虚拟机中每一段使用 ObjFunction 的代码，并将其改为使用 ObjClosure——函数调用、调用帧，等等。不过，我们会从指令开始。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_CLOSURE: {
        ObjFunction* function = AS_FUNCTION(READ_CONSTANT());
        ObjClosure* closure = newClosure(function);
        push(OBJ_VAL(closure));
        break;
      }
      // 新增部分结束
      case OP_RETURN: {
```

与我们前面使用的`OP_CONSTANT`类似，首先从常量表中加载已编译的函数。现在的不同之处在于，我们将该函数包装在一个新的 ObjClosure 中，并将结果压入堆栈。

一旦你有了一个闭包，你最终就会想要调用它。

_<u>vm.c，在 callValue()方法中替换 2 行：</u>_

```c
    switch (OBJ_TYPE(callee)) {
      // 替换部分开始
      case OBJ_CLOSURE:
        return call(AS_CLOSURE(callee), argCount);
      // 替换部分结束
      case OBJ_NATIVE: {
```

我们删除了调用`OBJ_FUNCTION`类型对象的代码。因为我们用 ObjClosures 包装了所有的函数，运行时永远不会再尝试调用原生的 ObjFunction。这些原生函数对象只存在于常量表中，并在其它部分看到它们之前立即被封装在闭包中。

我们用非常相似的调用闭包的代码来代替旧代码。唯一的区别是传递给`call()`的类型。真正的变化在这个函数中。首先，我们更新它的签名。

_<u>vm.c，在函数 call()中，替换 1 行：</u>_

```c
// 替换部分开始
static bool call(ObjClosure* closure, int argCount) {
// 替换部分结束
  if (argCount != function->arity) {
```

然后，在主体中，我们需要修正所有引用该函数的内容，以便处理我们引入中间层的问题。首先从元数检查开始：

_<u>vm.c，在 call()方法中，替换 3 行：</u>_

```c
static bool call(ObjClosure* closure, int argCount) {
  // 替换部分开始
  if (argCount != closure->function->arity) {
    runtimeError("Expected %d arguments but got %d.",
        closure->function->arity, argCount);
    // 替换部分结束
    return false;
```

唯一的变化是，我们解开闭包获得底层函数。`call()`做的下一件事是创建一个新的 CallFrame。我们修改这段代码，将闭包存储在 CallFrame 中，并从闭包内的函数中获取字节码指针。

_<u>vm.c，在 call()方法中，替换 2 行：</u>_

```c
  CallFrame* frame = &vm.frames[vm.frameCount++];
  // 替换部分开始
  frame->closure = closure;
  frame->ip = closure->function->chunk.code;
  // 替换部分结束
  frame->slots = vm.stackTop - argCount - 1;
```

这就需要修改 CallFrame 的声明。

_<u>vm.h，在结构体 CallFrame 中，替换 1 行：</u>_

```c
typedef struct {
  // 替换部分开始
  ObjClosure* closure;
  // 替换部分结束
  uint8_t* ip;
```

这一更改触发了其它一些级联更改。VM 中所有访问 CallFrame 中函数的地方都需要使用闭包来代替。首先，是从当前函数常量表中读取常量的宏：

_<u>vm.c，在 run()方法中，替换 2 行：</u>_

```c
    (uint16_t)((frame->ip[-2] << 8) | frame->ip[-1]))
// 替换部分开始
#define READ_CONSTANT() \
    (frame->closure->function->chunk.constants.values[READ_BYTE()])
// 替换部分结束
#define READ_STRING() AS_STRING(READ_CONSTANT())
```

当`DEBUG_TRACE_EXECUTION`被启用时，它需要从闭包中获取字节码块。

_<u>vm.c，在 run()方法中，替换 2 行：</u>_

```c
    printf("\n");
    // 替换部分开始
    disassembleInstruction(&frame->closure->function->chunk,
        (int)(frame->ip - frame->closure->function->chunk.code));
    // 替换部分结束
#endif
```

同样地，在报告运行时错误时也是如此：

_<u>vm.c，在 runtimeError()方法中，替换 1 行：</u>_

```c
    CallFrame* frame = &vm.frames[i];
    // 替换部分开始
    ObjFunction* function = frame->closure->function;
    // 替换部分结束
    size_t instruction = frame->ip - function->chunk.code - 1;
```

差不多完成了。最后一部分是用来设置第一个 CallFrame 以开始执行 Lox 脚本顶层程序的代码块。

_<u>vm.c，在 interpret()方法中，替换 1 行[^6]：</u>_

```c
  push(OBJ_VAL(function));
  // 替换部分开始
  ObjClosure* closure = newClosure(function);
  pop();
  push(OBJ_VAL(closure));
  call(closure, 0);
  // 替换部分结束
  return run();
```

编译脚本时，编译器仍然返回一个原始的 ObjFunction。这是可以的，但这意味着我们现在（也就是在 VM 能够执行它之前），需要将其包装在一个 ObjClosure 中。

我们又得到了一个可以工作的解释器。*用户*看不出有什么不同，但是编译器现在生成的代码会告诉虚拟机，为每一个函数声明创建一个闭包。每当 VM 执行一个函数声明时，它都会将 ObjFunction 包装在一个新的 ObjClosure 中。VM 的其余部分会处理那些四处漂浮的 ObjClosures。无聊的事情就到此为止吧。现在，我们准备让这些闭包实际*做*一些事情。

## 25.2 上值

我们现有的读写局部变量的指令只限于单个函数的栈窗口。来自外围函数的局部变量是在内部函数的窗口之外。我们需要一些新的指令。

最简单的方法可能是一条指令，接受一个栈槽相对偏移量，可以访问当前函数窗口*之前*的位置。如果闭包变量始终在栈上，这是有效的。但正如我们前面看到的，这些变量的生存时间有时会比声明它们的函数更长。这意味着它们不会一直在栈中。

然后，次简单的方法是获取闭包使用的任意局部变量，并让它始终存活在堆中。当执行外围函数中的局部变量声明时，虚拟机会为其动态分配内存。这样一来，它就可以根据需要长期存活。

如果 clox 不是单遍编译器，这会是一种很好的方法。但是我们在实现中所选择的这种限制使事情变得更加困难。看看这个例子：

```javascript
fun outer() {
  var x = 1;    // (1)
  x = 2;        // (2)
  fun inner() { // (3)
    print x;
  }
  inner();
}
```

在这里，编译器在`(1)`处编译了`x`的声明，并在`(2)`处生成了赋值代码。这些发生在编译器到达在`(3)`处的`inner()`声明并发现`x`实际上被闭包引用之前。我们没有一种简单的方法来回溯并修复已生成的代码，以特殊处理`x`。相反，我们想要的解决方案是，在*变量被关闭之前*，允许它像常规的局部变量一样存在于栈中。

幸运的是，感谢 Lua 开发团队，我们有了一个解决方案。我们使用一种他们称之为**上值**的中间层。上值指的是一个闭包函数中的局部变量。每个闭包都维护一个上值数组，每个上值对应闭包使用的外围局部变量。

上值指向栈中它所捕获的变量所在的位置。当闭包需要访问一个封闭的变量时，它会通过相应的上值(`upvalues`)得到该变量。当某个函数声明第一次被执行，而且我们为其创建闭包时，虚拟机会创建一个上值数组，并将其与闭包连接起来，以“捕获”闭包需要的外围局部变量。

举个例子，如果我们把这个程序扔给 clox

```javascript
{
  var a = 3;
  fun f() {
    print a;
  }
}
```

编译器和运行时会合力在内存中构建一组这样的对象：

![The object graph of the stack, ObjClosure, ObjFunction, and upvalue array.](./open-upvalue.png)

这可能看起来让人不知所措，但不要害怕。我们会用自己的方式来完成的。重要的部分是，上值充当了中间层，以便在被捕获的局部变量离开堆栈后能继续找到它。但在此之前，让我们先关注一下编译捕获的变量。

### 25.2.1 编译上值

像往常一样，我们希望在编译期间做尽可能多的工作，从而保持执行的简单快速。由于局部变量在 Lox 是具有词法作用域的，我们在编译时有足够的信息来确定某个函数访问了哪些外围的局部变量，以及这些局部变量是在哪里声明的。反过来，这意味着我们知道闭包需要*多少个*上值，它们捕获了*哪个*变量，以及在声明函数的栈窗口中的*哪个栈槽*中包含这些变量。

目前，当编译器解析一个标识符时，它会从最内层到最外层遍历当前函数的块作用域。如果我们没有在函数中找到该变量，我们就假定该变量一定是一个全局变量。我们不考虑封闭函数的局部作用域——它们会被直接跳过。那么，第一个变化就是为这些外围局部作用域插入一个解析步骤。

_<u>compiler.c，在 namedVariable()方法中添加代码：</u>_

```c
  if (arg != -1) {
    getOp = OP_GET_LOCAL;
    setOp = OP_SET_LOCAL;
  // 新增部分开始
  } else if ((arg = resolveUpvalue(current, &name)) != -1) {
    getOp = OP_GET_UPVALUE;
    setOp = OP_SET_UPVALUE;
  // 新增部分结束
  } else {
```

这个新的`resolveUpvalue()`函数会查找在任何外围函数中声明的局部变量。如果找到了，就会返回该变量的“上值索引”。（我们稍后会解释这是什么意思）否则，它会返回`-1`，表示没有找到该变量。如果找到变量，我们就使用这两条新指令，通过其上值对变量进行读写：

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_SET_GLOBAL,
  // 新增部分开始
  OP_GET_UPVALUE,
  OP_SET_UPVALUE,
  // 新增部分结束
  OP_EQUAL,
```

我们是自上而下实现的，所以我们很快会向你展示这些在运行时是如何工作的。现在要关注的部分是编译器实际上是如何解析标识符的。

_<u>compiler.c，在 resolveLocal()方法后添加代码：</u>_

```c
static int resolveUpvalue(Compiler* compiler, Token* name) {
  if (compiler->enclosing == NULL) return -1;

  int local = resolveLocal(compiler->enclosing, name);
  if (local != -1) {
    return addUpvalue(compiler, (uint8_t)local, true);
  }

  return -1;
}
```

在当前函数作用域中解析局部变量失败后，我们才会调用这个方法，因此我们知道该变量不在当前编译器中。回顾一下，Compiler 中存储了一个指向外层函数 Compiler 的指针，这些指针形成了一个链，一直到顶层代码的根 Compiler。因此，如果外围的 Compiler 是`NULL`，我们就知道已经到达最外层的函数，而且没有找到局部变量。那么该变量一定是全局的[^7]，所以我们返回`-1`。

否则，我们尝试将标识符解析为一个在*外围*编译器中的*局部*变量。换句话说，我们在当前函数外面寻找它。举例来说：

```javascript
fun outer() {
  var x = 1;
  fun inner() {
    print x; // (1)
  }
  inner();
}
```

当在`(1)`处编译标识符表达式时，`resolveUpvalue()`会查找在`outer()`中定义的局部变量`x`。如果找到了（就像本例中这样），那我们就成功解析了该变量。我们创建一个上值，以便内部函数可以通过它访问变量。上值是在这里创建的：

_<u>compiler.c，在 resolveLocal()方法后添加代码：</u>_

```c
static int addUpvalue(Compiler* compiler, uint8_t index,
                      bool isLocal) {
  int upvalueCount = compiler->function->upvalueCount;
  compiler->upvalues[upvalueCount].isLocal = isLocal;
  compiler->upvalues[upvalueCount].index = index;
  return compiler->function->upvalueCount++;
}
```

编译器保留了一个上值结构的数组，用以跟踪每个函数主体中已解析的封闭标识符。还记得编译器的 Local 数组是如何反映局部变量在运行时所在的栈槽索引的吗？这个新的上值数组也使用相同的方式。编译器数组中的索引，与运行时 ObjClosure 中上值所在的索引相匹配。

这个函数向数组中添加了一个新的上值。它还记录了该函数所使用的上值的数量。它直接在 ObjFunction 中存储了这个计数值，因为我们在运行时也需要使用这个数字[^8]。

`index`字段记录了封闭局部变量的栈槽索引。这样，编译器就知道需要捕获外部函数中的*哪个*变量。用不了多久，我们会回过头来讨论`isLocal`字段的用途。最后，`addUpvalue()`返回已创建的上值在函数的上值列表中的索引。这个索引会成为`OP_GET_UPVALUE`和`OP_SET_UPVALUE`指令的操作数。

这就是解析上值的基本思路，但是这个函数还没有完全成熟。一个闭包可能会多次引用外围函数中的同一个变量。在这种情况下，我们不想浪费时间和内存来为每个标识符表达式创建一个单独的上值。为了解决这个问题，在我们添加新的上值之前，我们首先要检查该函数是否已经有封闭该变量的上值。

_<u>compiler.c，在 addUpvalue()方法中添加代码：</u>_

```c
  int upvalueCount = compiler->function->upvalueCount;
  // 新增部分开始
  for (int i = 0; i < upvalueCount; i++) {
    Upvalue* upvalue = &compiler->upvalues[i];
    if (upvalue->index == index && upvalue->isLocal == isLocal) {
      return i;
    }
  }
  // 新增部分结束
  compiler->upvalues[upvalueCount].isLocal = isLocal;
```

如果我们在数组中找到与待添加的上值索引相匹配的上值，我们就返回该*上值*的索引并复用它。否则，我们就放弃，并添加新的上值。

这两个函数访问并修改了一些新的状态，所以我们来定义一下。首先，我们将上值计数添加到 ObjFunction 中。

_<u>object.h，在结构体 ObjFunction 中添加代码：</u>_

```c
  int arity;
  // 新增部分开始
  int upvalueCount;
  // 新增部分结束
  Chunk chunk;
```

我们是负责的 C 程序员，所以当 ObjFunction 第一次被分配时，我们将其初始化为 0。

_<u>object.c，在 newFunction()方法中添加代码：</u>_

```c
  function->arity = 0;
  // 新增部分开始
  function->upvalueCount = 0;
  // 新增部分结束
  function->name = NULL;
```

在编译器中，我们添加一个字段来存储上值数组。

_<u>compiler.c，在结构体 Compiler 中添加代码：</u>_

```c
  int localCount;
  // 新增部分开始
  Upvalue upvalues[UINT8_COUNT];
  // 新增部分结束
  int scopeDepth;
```

为了简单起见，我给了它一个固定的大小。`OP_GET_UPVALUE`和`OP_SET_UPVALUE`指令使用一个单字节操作数来编码上值索引，所以一个函数可以有多少个上值（可以封闭多少个不同的变量）是有限制的。鉴于此，我们可以负担得起这么大的静态数组。我们还需要确保编译器不会超出这个限制。

_<u>compiler.c，在 addUpvalue()方法中添加代码：</u>_

```c
    if (upvalue->index == index && upvalue->isLocal == isLocal) {
      return i;
    }
  }
  // 新增部分开始
  if (upvalueCount == UINT8_COUNT) {
    error("Too many closure variables in function.");
    return 0;
  }
  // 新增部分结束
  compiler->upvalues[upvalueCount].isLocal = isLocal;
```

最后，是 Upvalue 结构体本身。

_<u>compiler.c，在结构体 Local 后添加代码：</u>_

```c
typedef struct {
  uint8_t index;
  bool isLocal;
} Upvalue;
```

`index`字段存储了上值捕获的是哪个局部变量槽。`isLocal`字段值得有自己的章节，我们接下来会讲到。

### 25.2.2 扁平化上值

在我之前展示的例子中，闭包访问的是在紧邻的外围函数中声明的变量。Lox 还支持访问在*任何*外围作用域中声明的局部变量，如：

```c
fun outer() {
  var x = 1;
  fun middle() {
    fun inner() {
      print x;
    }
  }
}
```

这里，我们在`inner()`中访问`x`。这个变量不是在`middle()`中定义的，而是要一直追溯到`outer()`中。我们也需要处理这样的情况。你*可能*认为这并不难，因为变量只是位于栈中更下面的某个位置。但是考虑一下这个复杂的例子：

如果你在编程语言方面工作的时间足够长，你就会开发出一种精细的技能，能够创造出像这样的怪异程序，这些程序在技术上是有效的，但很可能会在一个由想象力没你那么变态的人编写的实现中出错。

```javascript
fun outer() {
  var x = "value";
  fun middle() {
    fun inner() {
      print x;
    }

    print "create inner closure";
    return inner;
  }

  print "return from outer";
  return middle;
}

var mid = outer();
var in = mid();
in();
```

当你运行这段代码时，应该打印出来：

```
return from outer
create inner closure
value
```

我知道，这很复杂。重要的是，在`inner()`的声明执行之前，`outer()`（`x`被声明的地方）已经返回并弹出其所有变量。因此，在我们为`inner()`创建闭包时，`x`已经离开了堆栈。

下面，我为你绘制了执行流程：

![Tracing through the previous example program.](./execution-flow.png)

看到了吗，`x`在被捕获 ② 之前，先被弹出 ①，随后又被访问 ③？我们确实有两个问题：

1. 我们需要解析在紧邻的函数之外的外围函数中声明的局部变量。
2. 我们需要能够捕获已经离开堆栈的变量。

幸运的是，我们正在向虚拟机中添加上值，而上值是明确为跟踪已退出栈的变量而设计的。因此，通过一个巧妙的自我引用，我们可以使用上值来允许上值捕获紧邻函数之外声明的变量。

解决方案是允许闭包捕获局部变量或紧邻函数中*已有的上值*。如果一个深度嵌套的函数引用了几跳之外声明的局部变量，我们让每个函数捕获一个上值，供下一个函数抓取，从而穿透所有的中间函数。

![An upvalue in inner() points to an upvalue in middle(), which points to a local variable in outer().](./linked-upvalues.png)

在上面的例子中，`middle()`捕获了紧邻的外层函数`outer()`中的局部变量`x`，并将其存储在自己的上值中。即使`middle()`本身不引用`x`，它也会这样做。然后，当`inner()`的声明执行时，它的闭包会从已捕获`x`的`middle()`对应的 ObjClosure 中抓取*上值*。函数只会从紧邻的外层函数中捕获局部变量或上值，因为这些值在内部函数声明执行时仍然能够确保存在。

为了实现这一点，`resolveUpvalue()`变成递归的。

_<u>compiler.c，在 resolveUpvalue()方法中添加代码：</u>_

```c
  if (local != -1) {
    return addUpvalue(compiler, (uint8_t)local, true);
  }
  // 新增部分开始
  int upvalue = resolveUpvalue(compiler->enclosing, name);
  if (upvalue != -1) {
    return addUpvalue(compiler, (uint8_t)upvalue, false);
  }
  // 新增部分结束
  return -1;
```

这只是另外加了三行代码，但我发现这个函数真的很难一次就正确完成。尽管我并没有发明什么新东西，只是从 Lua 中移植了这个概念。大多数递归函数要么在递归调用之前完成所有工作（**先序遍历**，或“下行”），要么在递归调用之后完成所有工作（**后续遍历**，或“回退”）。这个函数两者都是，递归调用就在中间。

我们来慢慢看一下。首先，我们在外部函数中查找匹配的局部变量。如果我们找到了，就捕获该局部变量并返回。这就是基本情况[^9]。

否则，我们会在紧邻的函数之外寻找局部变量。我们通过递归地对外层编译器（而不是当前编译器）调用`resolveUpvalue()`来实现这一点。这一系列的`resolveUpvalue()`调用沿着嵌套的编译器链运行，直到遇见基本情况——要么找到一个事件的局部变量来捕获，要么是遍历完了所有编译器。

当找到局部变量时，嵌套最深的`resolveUpvalue()`调用会捕获它并返回上值的索引。这就会返回到内层函数声明对应的下一级调用。该调用会捕获外层函数中的*上值*，以此类推。随着对`resolveUpvalue()`的每个嵌套调用的返回，我们会往下钻到最内层函数声明，即我们正在解析的标识符出现的地方。在这一过程中的每一步，我们都向中间函数添加一个上值，并将得到的上值索引向下传递给下一个调用[^10]。

在解析`x`的时候，走一遍原始的例子可能会有帮助：

![Tracing through a recursive call to resolveUpvalue().](./recursion.png)

请注意，对`addUpvalue()`的新调用为`isLocal`参数传递了`false`。现在你可以看到，该标志控制着闭包捕获的是局部变量还是来自外围函数的上值。

当编译器到达函数声明的结尾时，每个变量的引用都已经被解析为局部变量、上值或全局变量。每个上值可以依次从外围函数中捕获一个局部变量，或者在传递闭包的情况下捕获一个上值。我们终于有了足够的数据来生成字节码，该字节码在运行时创建一个捕获所有正确变量的闭包。

_<u>compiler.c，在 function()方法中添加代码：</u>_

```c
  emitBytes(OP_CLOSURE, makeConstant(OBJ_VAL(function)));
  // 新增部分开始
  for (int i = 0; i < function->upvalueCount; i++) {
    emitByte(compiler.upvalues[i].isLocal ? 1 : 0);
    emitByte(compiler.upvalues[i].index);
  }
  // 新增部分结束
}
```

`OP_CLOSURE`指令的独特之处在于，它是不定长编码的。对于闭包捕获的每个上值，都有两个单字节的操作数。每一对操作数都指定了上值捕获的内容。如果第一个字节是 1，它捕获的就是外层函数中的一个局部变量。如果是 0，它捕获的是函数的一个上值。下一个字节是要捕获局部变量插槽或上值索引。

这种奇怪的编码意味着我们需要在反汇编程序中对`OP_CLOSURE`提供一些定制化的支持。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      printf("\n");
      // 新增部分开始
      ObjFunction* function = AS_FUNCTION(
          chunk->constants.values[constant]);
      for (int j = 0; j < function->upvalueCount; j++) {
        int isLocal = chunk->code[offset++];
        int index = chunk->code[offset++];
        printf("%04d      |                     %s %d\n",
               offset - 2, isLocal ? "local" : "upvalue", index);
      }
      // 新增部分结束
      return offset;
```

举例来说，请看这个脚本：

```javascript
fun outer() {
  var a = 1;
  var b = 2;
  fun middle() {
    var c = 3;
    var d = 4;
    fun inner() {
      print a + c + b + d;
    }
  }
}
```

如果我们反汇编为`inner()`创建闭包的指令，它会打印如下内容：

```
0004    9 OP_CLOSURE          2 <fn inner>
0006      |                     upvalue 0
0008      |                     local 1
0010      |                     upvalue 1
0012      |                     local 2
```

我们还有两条更简单的指令需要添加反汇编支持。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
    case OP_SET_GLOBAL:
      return constantInstruction("OP_SET_GLOBAL", chunk, offset);
    // 新增部分开始
    case OP_GET_UPVALUE:
      return byteInstruction("OP_GET_UPVALUE", chunk, offset);
    case OP_SET_UPVALUE:
      return byteInstruction("OP_SET_UPVALUE", chunk, offset);
    // 新增部分结束
    case OP_EQUAL:
```

这两条指令都是单字节操作数，所有没有什么有趣的内容。我们确实需要添加一个头文件引入，以便调试模块能够访问`AS_FUNCTION()`。

_<u>debug.c，添加代码：</u>_

```c
#include "debug.h"
// 新增部分开始
#include "object.h"
// 新增部分结束
#include "value.h"
```

有了这些，我们的编译器就达到了我们想要的效果。对于每个函数声明，它都会输出一条`OP_CLOSURE`指令，后跟一系列操作数字节对，对应需要在运行时捕获的每个上值。现在是时候跳到虚拟机那边，让整个程序运转起来。

## 25.3 Upvalue 对象

现在每条`OP_CLOSURE`指令后面都跟着一系列字节，这些字节指定了 ObjClosure 应该拥有的上值。在处理这些操作数之前，我们需要一个上值的运行时表示。

_<u>object.h，在结构体 ObjString 后添加代码：</u>_

```c
typedef struct ObjUpvalue {
  Obj obj;
  Value* location;
} ObjUpvalue;
```

我们知道上值必须管理已关闭的变量，这些变量不再存活于栈上，这意味着需要一些动态分配。在我们的虚拟机中，最简单的方法就是在已有的对象系统上进行构建。这样，当我们在下一章中实现垃圾收集器时，GC 也可以管理上值的内存。

因此，我们的运行时上值结构是一个具有典型 Obj 头字段的 ObjUpvalue。之后是一个指向关闭变量的`location`字段。注意，这是一个指向 Value 的指针，而不是 Value 本身。它是一个*变量*的引用，而不是一个*值*。这一点很重要，因为它意味着当我们向上值捕获的变量赋值时，我们是在给实际的变量赋值，而不是对一个副本赋值。举例来说：

```javascript
fun outer() {
  var x = "before";
  fun inner() {
    x = "assigned";
  }
  inner();
  print x;
}
outer();
```

这个程序应该打印“assigned”，尽管是在闭包中对`x`赋值，而在外围函数中访问它。

因为上值是对象，我们已经有了所有常见的对象机制，首先是类似构造器的函数：

_<u>object.h，在 copyString()方法后添加代码：</u>_

```c
ObjString* copyString(const char* chars, int length);
// 新增部分开始
ObjUpvalue* newUpvalue(Value* slot);
// 新增部分结束
void printObject(Value value);
```

它接受的是封闭变量所在的槽的地址。下面是其实现：

_<u>object.c，在 copyString()方法后添加代码：</u>_

```c
ObjUpvalue* newUpvalue(Value* slot) {
  ObjUpvalue* upvalue = ALLOCATE_OBJ(ObjUpvalue, OBJ_UPVALUE);
  upvalue->location = slot;
  return upvalue;
}
```

我们简单地初始化对象并存储指针。这需要一个新的对象类型。

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
  OBJ_STRING,
  // 新增部分开始
  OBJ_UPVALUE
  // 新增部分结束
} ObjType;
```

在后面，还有一个类似析构函数的方法：

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
      FREE(ObjString, object);
      break;
    }
    // 新增部分开始
    case OBJ_UPVALUE:
      FREE(ObjUpvalue, object);
      break;
    // 新增部分结束
  }
```

多个闭包可以关闭同一个变量，所以 ObjUpvalue 并不拥有它引用的变量。因此，唯一需要释放的就是 ObjUpvalue 本身。

最后，是打印：

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
    case OBJ_STRING:
      printf("%s", AS_CSTRING(value));
      break;
    // 新增部分开始
    case OBJ_UPVALUE:
      printf("upvalue");
      break;
    // 新增部分结束
  }
```

打印对终端用户没有用。上值是对象，只是为了让我们能够利用虚拟机的内存管理。它们并不是 Lox 用户可以在程序中直接访问的一等公民。因此，这段代码实际上永远不会执行……但它使得编译器不会因为未处理的 case 分支而对我们大喊大叫，所以我们这样做了。

### 25.3.1 闭包中的上值

我在第一次介绍上值时，说过每个闭包中都有一个上值数组。我们终于回到了实现它的道路上。

_<u>object.h，在结构体 ObjClosure 中添加代码：</u>_

```c
  ObjFunction* function;
  // 新增部分开始
  ObjUpvalue** upvalues;
  int upvalueCount;
  // 新增部分结束
} ObjClosure;
```

不同的闭包可能会有不同数量的上值，所以我们需要一个动态数组。上值本身也是动态分配的，因此我们最终需要一个二级指针——一个指向动态分配的上值指针数组的指针。我们还会存储数组中的元素数量[^11]。

当我们创建 ObjClosure 时，会分配一个适当大小的上值数组，这个大小在编译时就已经确定并存储在 ObjFunction 中。

_<u>object.c，在 newClosure()方法中添加代码：</u>_

```c
ObjClosure* newClosure(ObjFunction* function) {
  // 新增部分开始
  ObjUpvalue** upvalues = ALLOCATE(ObjUpvalue*,
                                   function->upvalueCount);
  for (int i = 0; i < function->upvalueCount; i++) {
    upvalues[i] = NULL;
  }
  // 新增部分结束
  ObjClosure* closure = ALLOCATE_OBJ(ObjClosure, OBJ_CLOSURE);
```

在创建闭包对象本身之前，我们分配了上值数组，并将其初始化为`NULL`。这种围绕内存的奇怪仪式是一场精心的舞蹈，为了取悦（即将到来的）垃圾收集器神灵。它可以确保内存管理器永远不会看到未初始化的内存。

然后，我们将数组存储在新的闭包中，并将计数值从 ObjFunction 中复制过来。

_<u>object.c，在 newClosure()方法中添加代码：</u>_

```c
  closure->function = function;
  // 新增部分开始
  closure->upvalues = upvalues;
  closure->upvalueCount = function->upvalueCount;
  // 新增部分结束
  return closure;
```

当我们释放 ObjClosure 时，也需要释放上值数组。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
    case OBJ_CLOSURE: {
      // 新增部分开始
      ObjClosure* closure = (ObjClosure*)object;
      FREE_ARRAY(ObjUpvalue*, closure->upvalues,
                 closure->upvalueCount);
      // 新增部分结束
      FREE(ObjClosure, object);
```

ObjClosure 并不拥有 ObjUpvalue 本身，但它确实拥有包含指向这些上值的指针的数组。

当解释器创建闭包时，我们会填充上值数组。在这里，我们会遍历`OP_CLOSURE`之后的所有操作数，以查看每个槽捕获了什么样的上值。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        push(OBJ_VAL(closure));
        // 新增部分开始
        for (int i = 0; i < closure->upvalueCount; i++) {
          uint8_t isLocal = READ_BYTE();
          uint8_t index = READ_BYTE();
          if (isLocal) {
            closure->upvalues[i] =
                captureUpvalue(frame->slots + index);
          } else {
            closure->upvalues[i] = frame->closure->upvalues[index];
          }
        }
        // 新增部分结束
        break;
```

这段代码是闭包诞生的神奇时刻。我们遍历了闭包所期望的每个上值。对于每个上值，我们读取一对操作数字节。如果上值在外层函数的一个局部变量上关闭，我们就让`captureUpvalue()`完成这项工作。

否则，我们从外围函数中捕获一个上值。`OP_CLOSURE`指令是在函数声明的末尾生成。在我们执行该声明时，*当前*函数就是外围的函数。这意味着当前函数的闭包存储在调用栈顶部的 CallFrame 中。因此，要从外层函数中抓取上值，我们可以直接从局部变量`frame`中读取，该变量缓存了一个对 CallFrame 的引用。

关闭局部变量更有趣。大部分工作发生在一个单独的函数中，但首先我们要计算传递给它的参数。我们需要在外围函数的栈窗口中抓取一个指向捕获的局部变量槽的指针。该窗口起点在`frame->slots`，指向槽 0。在其上添加`index`偏移量，以指向我们想要捕获的局部变量槽。我们将该指针传入这里：

_<u>vm.c，在 callValue()方法后添加代码：</u>_

```c
static ObjUpvalue* captureUpvalue(Value* local) {
  ObjUpvalue* createdUpvalue = newUpvalue(local);
  return createdUpvalue;
}
```

这看起来有点傻。它所做的就是创建一个新的捕获给定栈槽的 ObjUpvalue，并将其返回。我们需要为此建一个单独的函数吗？嗯，不，*现在还*不用。但你懂的，我们最终会在这里插入更多代码。

首先，来总结一下我们的工作。回到处理`OP_CLOSURE`的解释器代码中，我们最终完成了对上值数组的迭代，并初始化了每个值。完成后，我们就有了一个新的闭包，它的数组中充满了指向变量的上值。

有了这个，我们就可以实现与这些上值相关的指令。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_GET_UPVALUE: {
        uint8_t slot = READ_BYTE();
        push(*frame->closure->upvalues[slot]->location);
        break;
      }
      // 新增部分结束
      case OP_EQUAL: {
```

操作数是当前函数的上值数组的索引。因此，我们只需查找相应的上值，并对其位置指针解引用，以读取该槽中的值。设置变量也是如此。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_SET_UPVALUE: {
        uint8_t slot = READ_BYTE();
        *frame->closure->upvalues[slot]->location = peek(0);
        break;
      }
      // 新增部分结束
      case OP_EQUAL: {
```

我们取栈顶的值，并将其存储的选中的上值所指向的槽中。就像局部变量的指令一样，这些指令的速度很重要。用户程序在不断的读写变量，因此如果这个操作很慢，一切都会很慢。而且，像往常一样，我们让它变快的方法就是保持简单。这两条新指令非常好：没有控制流，没有复杂的算术，只有几个指针间接引用和一个`push()`[^12]。

这是一个里程碑。只要所有的变量都留存在栈上，闭包就可以工作。试试这个：

```javascript
fun outer() {
  var x = "outside";
  fun inner() {
    print x;
  }
  inner();
}
outer();
```

运行这个，它就会正确地打印“outside”。

## 25.4 关闭的上值

当然，闭包的一个关键特性是，只要有需要，它们就会一直保留这个变量，即使声明变量的函数已经返回。下面是另一个应该*有效*的例子：

```javascript
fun outer() {
  var x = "outside";
  fun inner() {
    print x;
  }

  return inner;
}

var closure = outer();
closure();
```

但是如果你现在运行它……天知道它会做什么？在运行时，他会从不包含关闭变量的栈槽中读取数据。正如我多次提到的，问题的关键在于闭包中的变量不具有栈语义。这意味着当声明它们的函数返回时，我们必须将它们从栈中取出。本章的最后一节就是实现这一点的。

### 25.4.1 值与变量

在我们开始编写代码之前，我想深入探讨一个重要的语义问题。闭包关闭的是一个*值*还是一个*变量*？这并不是一个纯粹的学术问题[^13]。我并不是在胡搅蛮缠。考虑一下：

```javascript
var globalSet;
var globalGet;

fun main() {
  var a = "initial";

  fun set() { a = "updated"; }
  fun get() { print a; }

  globalSet = set;
  globalGet = get;
}

main();
globalSet();
globalGet();
```

外层的`main()`方法创建了两个闭包，并将它们存储在全局变量中，这样它们的存活时间就比`main()`本身的执行时间更长。这两个闭包都捕获了相同的变量。第一个闭包为其赋值，第二个闭包则读取该变量的值[^14]。

调用`globalGet()`会打印什么？如果闭包捕获的是*值*，那么每个闭包都会获得自己的`a`副本，该副本的值为`a`在执行闭包函数声明的时间点上的值。对`globalSet()`的调用会修改`set()`中的`a`副本，但是`get()`中的副本不受影响。因此，对`globalGet()`的调用会打印“initial”。

如果闭包关闭的是变量，那么`get()`和`set()`都会捕获（引用）_同一个可变变量_。当`set()`修改`a`时，它改变的是`get()`所读取的那个`a`。这里只有一个`a`。这意味着对`globalGet()`的调用会打印“updated”。

到底是哪一个呢？对于 Lox 和我所知的其它大多数带闭包的语言来说，答案是后者。闭包捕获的是变量。你可以把它们看作是对*值所在位置*的捕获。当我们处理不再留存于栈上的闭包变量时，这一点很重要，要牢牢记住。当一个变量移动到堆中时，我们需要确保所有捕获该变量的闭包都保留对其新位置的引用。这样一来，当变量发生变化时，所有闭包都能看到这个变化。

### 25.4.2 关闭上值

我们知道，局部变量总是从堆栈开始。这样做更快，并且可以让我们的单遍编译器在发现变量被捕获之前先生成字节码。我们还知道，如果闭包的存活时间超过声明被捕获变量的函数，那么封闭的变量就需要移动到堆中。

跟随 Lua，我们会使用**开放上值**来表示一个指向仍在栈中的局部变量的上值。当变量移动到堆中时，我们就*关闭*上值，而结果自然就是一个**关闭的上值**。我们需要回答两个问题：

1. 被关闭的变量放在堆中的什么位置？
2. 我们什么时候关闭上值？

第一个问题的答案很简单。我们在堆上已经有了一个便利的对象，它代表了对某个变量（ObjUpvalue 本身）的引用。被关闭的变量将移动到 ObjUpvalue 结构体中的一个新字段中。这样一来，我们不需要做任何额外的堆分配来关闭上值。

第二个问题也很直截了当。只要变量在栈中，就可能存在引用它的代码，而且这些代码必须能够正确工作。因此，将变量提取到堆上的逻辑时间越晚越好。如果我们在局部变量超出作用域时将其移出，我们可以肯定，在那之后没有任何代码会试图从栈中访问它。在变量超出作用域之后[^15]，如果有任何代码试图访问它，编译器就会报告一个错误。

当局部变量超出作用域时，编译器已经生成了`OP_POP`指令[^16]。如果变量被某个闭包捕获，我们会发出一条不同的指令，将该变量从栈中提取到其对应的上值。为此，编译器需要知道哪些局部变量被关闭了。

编译器已经为函数中的每个局部变量维护了一个 Upvalue 结构体的数组，以便准确地跟踪该状态。这个数组很好地回答了“这个闭包使用了哪个变量”，但他不适合回答“是否有*任何*函数捕获了这个局部变量？”特别是，一旦某个闭包的 Compiler 执行完成，变量被捕获的外层函数的 Compiler 就不能再访问任何上值状态了。

换句话说，编译器保持着从上值指向它们捕获的局部变量的指针，而没有相反方向的指针。所以，我们首先需要在现有的 Local 结构体中添加额外的跟踪信息，这样我们就能够判断某个给定的局部变量是否被某个闭包捕获。

_<u>compiler.c，在 Local 结构体中添加代码：</u>_

```c
  int depth;
  // 新增部分开始
  bool isCaptured;
  // 新增部分结束
} Local;
```

如果局部变量被后面嵌套的任何函数声明捕获，字段则为`true`。最初，所有的局部数据都没有被捕获。

_<u>compiler.c，在 addLocal()方法中添加代码：</u>_

```c
  local->depth = -1;
  // 新增部分开始
  local->isCaptured = false;
  // 新增部分结束
}
```

同样地，编译器隐式声明的特殊的“槽 0 中的局部变量”不会被捕获[^17]。

_<u>compiler.c，在 initCompiler()方法中添加代码：</u>_

```c
  local->depth = 0;
  // 新增部分开始
  local->isCaptured = false;
  // 新增部分结束
  local->name.start = "";
```

在解析标识符时，如果我们最终为某个局部变量创建了一个上值，我们将其标记为已捕获。

_<u>compiler.c，在 resolveUpvalue()方法中添加代码：</u>_

```c
  if (local != -1) {
    // 新增部分开始
    compiler->enclosing->locals[local].isCaptured = true;
    // 新增部分结束
    return addUpvalue(compiler, (uint8_t)local, true);
```

现在，在块作用域的末尾，当编译器生成字节码来释放局部变量的栈槽时，我们可以判断哪些数据需要被提取到堆中。我们将使用一个新指令来实现这一点。

_<u>compiler.c，在 endScope()方法中，替换 1 行：</u>_

```c
  while (current->localCount > 0 &&
         current->locals[current->localCount - 1].depth >
            current->scopeDepth) {
    // 新增部分开始
    if (current->locals[current->localCount - 1].isCaptured) {
      emitByte(OP_CLOSE_UPVALUE);
    } else {
      emitByte(OP_POP);
    }
    // 新增部分结束
    current->localCount--;
  }
```

这个指令不需要操作数。我们知道，在该指令执行时，变量一定在栈顶。我们来声明这条指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_CLOSURE,
  // 新增部分开始
  OP_CLOSE_UPVALUE,
  // 新增部分结束
  OP_RETURN,
```

并为它添加简单的反汇编支持：

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
    }
    // 新增部分开始
    case OP_CLOSE_UPVALUE:
      return simpleInstruction("OP_CLOSE_UPVALUE", offset);
    // 新增部分结束
    case OP_RETURN:
```

太好了。现在，生成的字节码准确地告诉运行时，每个被捕获的局部变量必须移动到堆中的确切时间。更好的是，它只对被闭包使用并需要这种特殊处理的局部变量才会这样做。这与我们的总体性能目标是一致的，即我们希望用户只为他们使用的功能付费。那些不被闭包使用的变量只会出现于栈中，就像以前一样。

### 25.4.3 跟踪开放的上值

让我们转到运行时方面。在解释`OP_CLOSE_UPVALUE`指令之前，我们还有一个问题需要解决。之前，在谈到闭包捕获的是变量还是值时，我说过，如果多个闭包访问同一个变量，它们最终将引用内存中完全相同的存储位置，这一点很重要。这样一来，如果某个闭包对变量进行写入，另一个闭包就会看到这一变化。

现在，如果两个闭包捕获同一个局部变量，虚拟机就会为每个闭包创建一个单独的 Upvalue。必要的共享是缺失的[^18]。当我们把变量移出堆栈时，如果我们只是将它移入其中一个上值中，其它上值就会有一个孤儿值。

为了解决这个问题，每当虚拟机需要一个捕获特定局部变量槽的上值时，我们会首先搜索指向该槽的现有上值。如果找到了，我们就重用它。难点在于，之前创建的所有上值都存储在各个闭包的上值数组中。这些闭包可能位于虚拟机内存中的任何位置。

第一步是给虚拟机提供它自己的所有开放上值的列表，这些上值指向仍在栈中的变量。每次虚拟机需要一个上值时，都要搜索列表，这听起来似乎很慢，但是实际上，这并没有那么坏。栈中真正被关闭的变量的数量往往很少。而且创建闭包的函数声明很少出现在用户程序中的性能关键执行路径上[^19]。

更妙的是，我们可以根据开放上值所指向的栈槽索引对列表进行排序。常见的情况是，某个栈槽还*没有*被捕获（在闭包之间共享变量是不常见的），而闭包倾向于捕获靠近栈顶的局部变量。如果我们按照栈槽的顺序存储开放上值数组，一旦我们越过正在捕获的局部变量所在的槽，我们就知道它不会被找到。当这个局部变量在栈顶时，我们可以很早就退出循环。

维护有序列表需要能高效地在中间插入元素。这一点建议我们使用链表而不是动态数组。因为我们自己定义了 ObjUpvalue 结构体，最简单的实现是一个插入式列表，将指向下一元素的指针放在 ObjUpvalue 结构体本身中。

_<u>object.h，在结构体 ObjUpvalue 中添加代码：</u>_

```c
  Value* location;
  // 新增部分开始
  struct ObjUpvalue* next;
  // 新增部分结束
} ObjUpvalue;
```

当我们分配一个上值时，它还没有附加到任何列表，因此链接是`NULL`。

_<u>object.c，在 newUpvalue()方法中添加代码：</u>_

```c
  upvalue->location = slot;
  // 新增部分开始
  upvalue->next = NULL;
  // 新增部分结束
  return upvalue;
```

VM 拥有该列表，因此头指针放在 VM 主结构体中。

_<u>vm.h，在结构体 VM 中添加代码：</u>_

```c
  Table strings;
  // 新增部分开始
  ObjUpvalue* openUpvalues;
  // 新增部分结束
  Obj* objects;
```

列表在开始时为空。

_<u>vm.c，在 resetStack()方法中添加代码：</u>_

```c
  vm.frameCount = 0;
  // 新增部分开始
  vm.openUpvalues = NULL;
  // 新增部分结束
}
```

从 VM 指向的第一个上值开始，每个开放上值都指向下一个引用了栈中靠下位置的局部变量的开放上值。以这个脚本为例

```javascript
{
  var a = 1;
  fun f() {
    print a;
  }
  var b = 2;
  fun g() {
    print b;
  }
  var c = 3;
  fun h() {
    print c;
  }
}
```

它应该产生如下所示的一系列链接的上值：

![Three upvalues in a linked list.](./linked-list.png)

每当关闭一个局部变量时，在创建新的上值之前，先在该列表中查找现有的上值。

_<u>vm.c，在 captureUpvalue()方法中添加代码：</u>_

```c
static ObjUpvalue* captureUpvalue(Value* local) {
  // 新增部分开始
  ObjUpvalue* prevUpvalue = NULL;
  ObjUpvalue* upvalue = vm.openUpvalues;
  while (upvalue != NULL && upvalue->location > local) {
    prevUpvalue = upvalue;
    upvalue = upvalue->next;
  }

  if (upvalue != NULL && upvalue->location == local) {
    return upvalue;
  }
  // 新增部分结束
  ObjUpvalue* createdUpvalue = newUpvalue(local);
```

我们从列表的头部开始，它是最接近栈顶的上值。我们遍历列表，使用一个小小的指针比较，对每一个指向的槽位高于当前查找的位置的上值进行迭代[^20]。当我们这样做时，我们要跟踪列表中前面的上值。如果我们在某个节点后面插入了一个节点，就需要更新该节点的`next`指针。

我们有三个原因可以退出循环：

1. **我们停止时的局部变量槽是我们要找的槽**。我在找到了一个现有的上值捕获了这个变量，因此我们重用这个上值。

2. **我们找不到需要搜索的上值了**。当`upvalue`为`NULL`时，这意味着列表中每个开放上值都指向位于我们要找的槽之上的局部变量，或者（更可能是）上值列表是空的。无论怎样，我们都没有找到对应该槽的上值。

3. **我们找到了一个上值，其局部变量槽低于我们正查找的槽位**。因为列表是有序的，这意味着我们已经超过了正在关闭的槽，因此肯定没有对应该槽的已有上值。

在第一种情况下，我们已经完成并且返回了。其它情况下，我们为局部变量槽创建一个新的上值，并将其插入到列表中的正确位置。

_<u>vm.c，在 captureUpvalue()方法中添加代码：</u>_

```c
  ObjUpvalue* createdUpvalue = newUpvalue(local);
  // 新增部分开始
  createdUpvalue->next = upvalue;

  if (prevUpvalue == NULL) {
    vm.openUpvalues = createdUpvalue;
  } else {
    prevUpvalue->next = createdUpvalue;
  }
  // 新增部分结束
  return createdUpvalue;
```

这个函数的当前版本已经创建了上值，我们只需要添加代码将上值插入到列表中。我们退出列表遍历的原因，要么是到达了列表末尾，要么是停在了第一个栈槽低于待查找槽位的上值。无论哪种情况，这都意味着我们需要在`upvalue`指向的对象（如果到达列表的末尾，则该对象可能是`NULL`）之前插入新的上值。

正如你在《数据结构 101》中所学到的，要将一个节点插入到链表中，你需要将前一个节点的`next`指针指向新的节点。当我们遍历列表时，我们一直很方便地跟踪着前面的节点。我们还需要处理一种特殊情况，即我们在列表头部插入一个新的上值，在这种情况下，“next”指针是 VM 的头指针[^21]。

有了这个升级版函数，VM 现在可以确保每个指定的局部变量槽都只有一个 ObjUpvalue。如果两个闭包捕获了相同的变量，它们会得到相同的上值。现在，我们准备将这些上值从栈中移出。

### 25.4.4 在运行时关闭上值

编译器会生成一个有用的`OP_CLOSE_UPVALUE`指令，以准确地告知 VM 何时将局部变量提取到堆中。执行该指令是解释器的责任。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_CLOSE_UPVALUE:
        closeUpvalues(vm.stackTop - 1);
        pop();
        break;
      // 新增部分结束
      case OP_RETURN: {
```

当我们到达该指令时，我们要提取的变量就在栈顶。我们调用一个辅助函数，传入栈槽的地址。该函数负责关闭上值，并将局部变量从栈中移动到堆上。之后，VM 就可以自由地丢弃栈槽，这是通过调用`pop()`实现的。

有趣的事情发生在这里：

_<u>vm.c，在 captureUpvalue()方法后添加代码：</u>_

```c
static void closeUpvalues(Value* last) {
  while (vm.openUpvalues != NULL &&
         vm.openUpvalues->location >= last) {
    ObjUpvalue* upvalue = vm.openUpvalues;
    upvalue->closed = *upvalue->location;
    upvalue->location = &upvalue->closed;
    vm.openUpvalues = upvalue->next;
  }
}
```

这个函数接受一个指向栈槽的指针。它会关闭它能找到的指向该槽或栈上任何位于该槽上方的所有开放上值。现在，我们只传递了一个指向栈顶的指针，所以“或其上方”的部分没有发挥作用，但它很快就会起作用了。

为此，我们再次从上到下遍历 VM 的开放上值列表。如果某个上值的位置指向我们要关闭的槽位范围，则关闭该上值。否则，一旦我们遇到范围之外的上值，我们知道其它上值也在范围之外，所以我们停止迭代。

关闭上值的方式非常酷[^22]。首先，我们将变量的值复制到 ObjUpvalue 的`closed`字段。这就是被关闭的变量在堆中的位置。在变量被移动之后，`OP_GET_UPVALUE`和`OP_SET_UPVALUE`指令需要在那里查找它。我们可以在解释器代码中为这些指令添加一些条件逻辑，检查一些标志，以确定上值是开放的还是关闭的。

但是已经有一个中间层在起作用了——这些指令对`location`指针解引用以获取变量的值。当变量从栈移动到`closed`字段时，我们只需将`location`更新为 ObjUpvalue*自己的*`closed`字段。

![Moving a value from the stack to the upvalue's 'closed' field and then pointing the 'value' field to it.](./closing.png)

我们根本不需要改变`OP_GET_UPVALUE`和`OP_SET_UPVALUE`的解释方式。这使得它们保持简单，反过来又使它们保持快速。不过，我们确实需要向 ObjUpvalue 添加新的字段。

_<u>object.h，在结构体 ObjUpvalue 中添加代码：</u>_

```c
  Value* location;
  // 新增部分开始
  Value closed;
  // 新增部分结束
  struct ObjUpvalue* next;
```

当我们创建一个 ObjUpvalue 时，应该将其置为 0，这样就不会有未初始化的内存了。

_<u>object.c，在 newUpvalue()方法中添加代码：</u>_

```c
  ObjUpvalue* upvalue = ALLOCATE_OBJ(ObjUpvalue, OBJ_UPVALUE);
  // 新增部分开始
  upvalue->closed = NIL_VAL;
  // 新增部分结束
  upvalue->location = slot;
```

每当编译器到达一个块的末尾时，它就会丢弃该代码块中的所有局部变量，并为每个关闭的局部变量生成一个`OP_CLOSE_UPVALUE`指令。编译器*不会*在定义某个函数主体的最外层块作用域的末尾生成任何指令[^23]。这个作用域包含函数的形参和函数内部声明的任何局部变量。这些也需要被关闭。

这就是`closeUpvalues()`接受一个指向栈槽的指针的原因。当函数返回时，我们调用相同的辅助函数，并传入函数拥有的第一个栈槽。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        Value result = pop();
        // 新增部分开始
        closeUpvalues(frame->slots);
        // 新增部分结束
        vm.frameCount--;
```

通过传递函数栈窗口中的第一个槽，我们关闭了正在返回的函数所拥有的所有剩余的开放上值。有了这些，我们现在就有了一个功能齐全的闭包实现。只要捕获变量的函数需要，被关闭的变量就一直存在。

这是一项艰巨的工作！在 jlox 中，闭包很自然地从我们的环境表示形式中分离出来。在 clox 中，我们必须添加大量的代码——新的字节码指令、编译器中的更多数据结构和新的运行时对象。VM 在很大程度上将闭包中的变量与其它变量进行区别对待。

这是有道理的。就实现复杂性而言，jlox“免费”为我们提供了闭包。但是就*性能*而言，jlox 的闭包完全不是这样。由于在堆上分配*所有*环境，jlox 为*所有*局部变量付出了显著的性能代价，甚至是未被闭包捕获的大部分变量。

在 clox 中，我们有一个更复杂的系统，但这允许我们对实现进行调整以适应我们观察到的局部变量的两种使用模式。对于大多数具有堆栈语义的变量，我们完全可用在栈中分配，这既简单又快速。然后，对于少数不适用的局部变量，我们可以根据需要选择第二条较慢的路径。

幸运的是，用户并不会察觉到这种复杂性。在他们看来，Lox 中的局部变量简单而统一。语言本身就像 jlox 一样简单。但在内部，clox 会观察用户的行为，并针对他们的具体用途进行优化。随着你的语言实现越来越复杂，你会发现自己要做的事情越来越多。“优化”的很大一部分是关于添加特殊情况的代码，以检测特定的使用，并为符合该模式的代码提供定制化的、更快速的路径。

我们现在已经在 clox 中完全实现了词法作用域，这是一个重要的里程碑。而且，现在我们有了具有复杂生命周期的函数和变量，我们也要了很多漂浮在 clox 堆中的对象，并有一个指针网络将它们串联起来。下一步是弄清楚如何管理这些内存，以便我们可以在不再需要这些对象的时候释放它们。

[^1]: 毕竟，C 和 Java 使用栈来存储局部变量是有原因的。
[^2]: 搜索“闭包转换 closure conversion”和“Lambda 提升 lambda lifting”就可以开始探索了。
[^3]: 换句话说，Lox 中的函数声明是一种字面量——定义某个内置类型的常量值的一段语法。
[^4]: Lua 实现中将包含字节码的原始函数对象称为“原型”，这个一个很好的形容词，只不过这个词也被重载以指代[原型继承](https://en.wikipedia.org/wiki/Prototype-based_programming)。
[^5]: 或许我应该定义一个宏，以便更容易地生成这些宏。也许这有点太玄了。
[^6]: 这段代码看起来有点傻，因为我们仍然把原始的 ObjFunction 压入栈中，然后在创建完闭包之后弹出它，然后再将闭包压入栈。为什么要把 ObjFunction 放在这里呢？像往常一样，当你看到奇怪的堆栈操作发生时，它是为了让即将到来的垃圾回收器知道一些堆分配的对象。
[^7]: 它最终可能会是一个完全未定义的变量，甚至不是全局变量。但是在 Lox 中，我们直到运行时才能检测到这个错误，所以从编译器的角度看，它是“期望是全局的”。
[^8]: 就像常量和函数元数一样，上值计数也是连接编译器与运行时的一些小数据。
[^9]: 当然，另一种基本情况是，没有外层函数。在这种情况下，该变量不能在词法上解析，并被当作全局变量处理。
[^10]: 每次递归调用`resolveUpvalue()`都会*走出*一层函数嵌套。因此，内部的*递归调用*指向的是*外部*的嵌套声明。查找局部变量的最内层的`resolveUpvalue()`递归调用对应的将是*最外层*的函数，就是实际声明该变量的外层函数的内部。
[^11]: 在闭包中存储上值数量是多余的，因为 ObjClosure 引用的 ObjFunction 也保存了这个数量。通常，这类奇怪的代码是为了适应 GC。在闭包对应的 ObjFunction 已经被释放后，收集器可能也需要知道 ObjClosure 对应上值数组的大小。
[^12]: 设置指令不会从栈中*弹出*值，因为，请记住，赋值在 Lox 中是一个表达式。所以赋值的结果（所赋的值）需要保留在栈中，供外围的表达式使用。
[^13]: 如果 Lox 不允许赋值，这就是一个学术问题。
[^14]: 我使用了多个全局变量的事实并不重要。我需要某种方式从一个函数中返回两个值。而在 Lox 中没有任何形式的聚合类型，我的选择很有限。
[^15]: 这里 的“之后”，指的是词法或文本意义上的——在包含关闭变量的声明语句的代码块的`}`之后的代码。
[^16]: 编译器不会弹出参数和在函数体中声明的局部变量。这些我们也会在运行时处理。
[^17]: 在本书的后面部分，用户将有可能捕获这个变量。这里只是建立一些预期。
[^18]: 如果某个闭包从外围函数中捕获了一个*上值*，那么虚拟机确实会共享上值。嵌套的情况下，工作正常。但是如果两个同级闭包捕获了同一个局部变量，它们会各自创建一个单独的 ObjUpvalue。
[^19]: 闭包经常在热循环中被*调用*。想想传递给集合的典型高阶函数，如`map()`和`filter()`。这应该是很快的。但是创建闭包的函数声明只发生一次，而且通常是在循环之外。
[^20]: 这是个单链表。除了从头指针开始遍历，我们没有其它选择。
[^21]: 还有一种更简短的实现，通过使用一个指向指针的指针，来统一处理更新头部指针或前一个上值的`next`指针两种情况，但这种代码几乎会让所有未达到指针专业水平的人感到困惑。我选择了基本的`if`语句的方法。
[^22]: 我并不是在自夸。这都是 Lua 开发团队的创新。
[^23]: 没有什么*阻止*我们在编译器中关闭最外层的函数作用域，并生成`OP_POP`和`OP_CLOSE_UPVALUE`指令。这样做只是没有必要，因为运行时在弹出调用帧时，隐式地丢弃了函数使用的所有栈槽。

---

## 习题

1. 将每个 ObjFunction 包装在 ObjClosure 中，会引入一个有性能代价的中间层。这个代价对于那些没有关闭任何变量的函数来说是不必要的，但它确实让运行时能够统一处理所有的调用。

   将 clox 改为只用 ObjClosure 包装需要上值的函数。与包装所有函数相比，代码的复杂性与性能如何？请注意对使用闭包和不使用闭包的程序进行基准测试。你应该如何衡量每个基准的重要性？如果一个变慢了，另一个变快了，你决定通过什么权衡来选择实现策略？

2. 请阅读下面的[设计笔记](#设计笔记：关闭循环变量)。我在这里等着。现在，你觉得 Lox 应该怎么做？改变实现方式，为每个循环迭代创建一个新的变量。

3. 一个[著名的公案](http://wiki.c2.com/?ClosuresAndObjectsAreEquivalent)告诉我们：“对象是简化版的闭包”（反之亦然）。我们的虚拟机还不支持对象，但现在我们有了闭包，我们可以近似地使用它们。使用闭包，编写一个 Lox 程序，建模一个二维矢量“对象”。它应该：

   - 定义一个“构造器”函数，创建一个具有给定 x 和 y 坐标的新矢量。
   - 提供“方法”来访问构造函数返回值的 x 和 y 坐标。
   - 定义一个相加“方法”，将两个向量相加并产生第三个向量。

---

## 设计笔记：关闭循环变量

闭包捕获变量。当两个闭包捕获相同的变量时，它们共享对相同的底层存储位置的引用。当将新值赋给该变量时，这一事实是可见的。显然，如果两个闭包捕获*不同*的变量，就不存在共享。

```javascript
var globalOne;
var globalTwo;

fun main() {
  {
    var a = "one";
    fun one() {
      print a;
    }
    globalOne = one;
  }

  {
    var a = "two";
    fun two() {
      print a;
    }
    globalTwo = two;
  }
}

main();
globalOne();
globalTwo();
```

这里会打印“one”然后是“two”。在这个例子中，很明显两个`a`变量是不同的。但一点这并不总是那么明显。考虑一下：

```javascript
var globalOne;
var globalTwo;

fun main() {
  for (var a = 1; a <= 2; a = a + 1) {
    fun closure() {
      print a;
    }
    if (globalOne == nil) {
      globalOne = closure;
    } else {
      globalTwo = closure;
    }
  }
}

main();
globalOne();
globalTwo();
```

这段代码很复杂，因为 Lox 没有集合类型。重要的部分是，`main()`函数进行了`for`循环的两次迭代。每次循环执行时，它都会创建一个捕获循环变量的闭包。它将第一个闭包存储在`globalOne`中，并将第二个闭包存储在`globalTwo`中。

这无疑是两个不同的闭包。它们是在两个不同的变量上闭合的吗？在整个循环过程中只有一个`a`，还是每个迭代都有自己单独的`a`变量？

这里的脚本很奇怪，而且是人为设计的，但它确实出现在实际的代码中，而且这些代码使用的语言并不是像 clox 这样的小语言。下面是一个 JavaScript 的示例：

```javascript
var closures = [];
for (var i = 1; i <= 2; i++) {
  closures.push(function () {
    console.log(i);
  });
}

closures[0]();
closures[1]();
```

这里会打印“1”再打印“2”，还是打印两次“3”？你可能会惊讶地发现，它打印了两次“3”[^24]。在这个 JavaScript 程序中，只有一个`i`变量，它的生命周期包括循环的所有迭代，包括最后的退出。

如果你熟悉 JavaScript，你可能知道，使用`var`声明的变量会隐式地被提取到外围函数或顶层作用域中。这就好像你是这样写的：

```javascript
var closures = [];
var i;
for (i = 1; i <= 2; i++) {
  closures.push(function () {
    console.log(i);
  });
}

closures[0]();
closures[1]();
```

此时，很明显只有一个`i`。现在考虑一下，如果你将程序改为使用更新的`let`关键字：

```javascript
var closures = [];
for (let i = 1; i <= 2; i++) {
  closures.push(function () {
    console.log(i);
  });
}

closures[0]();
closures[1]();
```

这个新程序的行为是一样的吗？不是。在本例中，它会打印“1”然后打印“2”。每个闭包都有自己的`i`。仔细想想会觉得有点奇怪，增量子句是`i++`，这看起来很像是对现有变量进行赋值和修改，而不是创建一个新变量。

让我们试试其它语言。下面是 Python：

```python
closures = []
for i in range(1, 3):
  closures.append(lambda: print(i))

closures[0]()
closures[1]()
```

Python 并没有真正的块作用域。变量是隐式声明的，并自动限定在外围函数的作用域中。现在我想起来，这有点像 JS 中的“悬挂”。所以两个闭包都捕获了同一个变量。但与 C 不同的是，我们不会通过增加`i`超过最后一个值来退出循环，所以这里会打印两次“2”。

那 Ruby 呢？Ruby 有两种典型的数值迭代方式。下面是典型的命令式风格：

```ruby
closures = []
for i in 1..2 do
  closures << lambda { puts i }
end

closures[0].call
closures[1].call
```

这有点像是 Python，会打印两次“2”。但是更惯用的 Ruby 风格是在范围对象上使用高阶的`each()`方法：

```ruby
closures = []
(1..2).each do |i|
  closures << lambda { puts i }
end

closures[0].call
closures[1].call
```

如果你不熟悉 Ruby，`do |i| ... end`部分基本上就是一个闭包，它被创建并传递给`each()`方法。`|i|`是闭包的参数签名。`each()`方法两次调用该闭包，第一次传入 1，第二次传入 2。

在这种情况下，“循环变量”实际上是一个函数参数。而且，由于循环的每次迭代都是对函数的单独调用，所以每次调用都是单独的变量。因此，这里先打印“1”然后打印“2”。

如果一门语言具有基于迭代器的高级循环结果，比如 C#中的`foreach`，Java 中的“增强型 for 循环”，JavaScript 中的`for-of`，Dart 中的`for-in`等等，那我认为读者很自然地会让每次迭代都创建一个新变量。代码*看起来*像一个新变量，是因为循环头看起来像是一个变量声明。看起来没有任何增量表达式通过改变变量以推进到下一步。

如果你在 StackOverflow 和其它地方挖掘一下，你会发现这正是用户所期望的，因为当他们*没有*看到这个结果时，他们会非常惊讶。特别是，C#最初并没有为`foreach`循环的每次迭代创建一个新的循环变量。这一点经常引起用户的困惑，所以他们采用了非常罕见的措施，对语言进行了突破性的修改。在 C# 5 中，每个迭代都会创建一个新的变量。

旧的 C 风格的`for`循环更难了。增量子句看起来像是修改。这意味着每一步更新的是同一个变量。但是每个迭代共享一个循环变量几乎是*没有用*的。只有在闭包捕获它时，你才能检测到这一现象。而且，如果闭包引用的变量的值是导致循环退出的值，那么它也几乎没有帮助。

实用的答案可能是像 JavaScript 在`for`循环中的`let`那样。让它看起来像修改，但实际上每次都创建一个新变量，因为这是用户想要的。不过，仔细想想，还是有点奇怪的。

[^24]: 你想知道“3”是怎么出现的吗？在第二次迭代后，执行`i++`，它将`i`增加到 3。这就是导致`i<=2`的值为 false 并结束循环的原因。如果`i`永远达不到 3，循环就会一直运行下去。
