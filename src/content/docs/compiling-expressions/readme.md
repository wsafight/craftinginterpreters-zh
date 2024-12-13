---
title: 17. 编译表达式
description: Compiling Expressions
---

> 方吾生之半路，恍余处乎幽林，失正轨而迷误。
>
> ​ —— Dante Alighieri, _Inferno_

【译者注：这里引用的是大名鼎鼎的《神曲》，所以我也直接引用了钱稻孙先生的译文】

这一章令人激动，原因不止一个，也不止两个，而是三个。首先，它补齐了虚拟机执行管道的最后一段。一旦到位，我们就可以处理用户的源代码，从扫描一直到执行。

![Lowering the 'compiler' section of pipe between 'scanner' and 'VM'.](./pipeline-16556853912551.png)

第二，我们要编写一个真正的*编译器*。它会解析源代码并输出低级的二进制指令序列。当然，它是字节码，而不是某个芯片的原生指令集，但它比 jlox 更接近于硬件。我们即将成为真正的语言黑客了。

第三，也是最后一个，我可以向你们展示我们最喜欢的算法之一：Vaughan Pratt 的“自顶向下算符优先解析”。这是我所知道的解析表达的最优雅的方法。它可以优雅地处理前缀、后缀、中缀、多元运算符，以及任何类型的运算符。它能处理优先级和结合性，而且毫不费力。我喜欢它。

与往常一样，在我们开始真正有趣的工作之前，还有一些准备工作需要做。在得到甜点之前，你得先吃点蔬菜。首先，让我们抛弃我们为测试扫描器而编写的临时脚手架，用更有效的东西来替换它。

_<u>vm.c，在 interpret() 方法中替换 2 行：</u>_

```c
InterpretResult interpret(const char* source) {
  // 替换部分开始
  Chunk chunk;
  initChunk(&chunk);

  if (!compile(source, &chunk)) {
    freeChunk(&chunk);
    return INTERPRET_COMPILE_ERROR;
  }

  vm.chunk = &chunk;
  vm.ip = vm.chunk->code;

  InterpretResult result = run();

  freeChunk(&chunk);
  return result;
  // 替换部分结束
}
```

我们创建一个新的空字节码块，并将其传递给编译器。编译器会获取用户的程序，并将字节码填充到该块中。至少在程序没有任何编译错误的情况下，它就会这么做。如果遇到错误，`compile()`方法会返回`false`，我们就会丢弃不可用的字节码块。

否则，我们将完整的字节码块发送到虚拟机中去执行。当虚拟机完成后，我们会释放该字节码块，这样就完成了。如你所见，现在`compile()`的签名已经不同了。

<u>_compiler.h，替换一行代码：_</u>

```c
#define clox_compiler_h
// 替换部分开始
#include "vm.h"

bool compile(const char* source, Chunk* chunk);
// 替换部分结束
#endif
```

我们将字节码块传入，而编译器会向其中写入代码，如何`compile()`返回编译是否成功。我们在实现方法中对签名进行相同的修改。

_<u>compiler.c，在 compile()方法中替换 1 行：</u>_

```c
#include "scanner.h"
// 替换部分开始
bool compile(const char* source, Chunk* chunk) {
// 替换部分结束
  initScanner(source);
```

对`initScanner()`的调用是本章中唯一保留下来的代码行。删除我们为测试扫描器而编写的临时代码，将其替换为以下三行：

_<u>compiler.c，在 compile()方法中替换 13 行：</u>_

```c
  initScanner(source);
  // 替换部分开始
  advance();
  expression();
  consume(TOKEN_EOF, "Expect end of expression.");
  // 替换部分结束
}
```

对`advance()`的调用会在扫描器上“启动泵”。我们很快会看到它的作用。然后我们解析一个表达式。我们还不打算处理语句，所以表达式是我们支持的唯一的语法子集。等到我们在后面的章节中添加语句时，会重新审视这个问题。在编译表达式之后，我们应该处于源代码的末尾，所以我们要检查 EOF 标识。

我们将用本章的剩余时间让这个函数工作起来。尤其是那个小小的`expression()`调用。通常情况下，我们会直接进入函数定义，并从上到下地进行实现。

这一章则不同。Pratt 的解析技术，你一旦理解了就非常简单，但是要把它分解成小块就比较麻烦了[^1]。当然，它是递归的，这也是问题的一部分。但它也依赖于一个很大的数据表。等我们构建算法时，这个表格会增加更多的列。

我不想在每次扩展表时都要重新查看 40 多行代码。因此，我们要从外部进入解析器的核心，并在进入有趣的中心之前覆盖其外围的所有部分。与大多数章节相比，这将需要更多的耐心和思考空间，但这是我能做到的最好的了。

## 17.1 单遍编译

一个编译器大约有两项工作[^2]。它会解析用户的源代码以理解其含义。然后，它利用这些知识并输出产生相同语义的低级指令。许多语言在实现中将这两个角色分成两遍独立的执行部分。一个解析器生成 AST——就像 jlox 那样——还有一个代码生成器遍历 AST 并输出目标代码。

在 clox 中，我们采用了一种老派的方法，将这两遍处理合而为一。在过去，语言黑客们这样做是因为计算机没有足够的内存来存储整个源文件的 AST。我们这样做是因为它使我们的编译器更简单，这是用 C 语言编程时的真正优势。

像我们要构建的单遍编译器并不是对所有语言都有效。因为编译器在生产代码时只能“管窥”用户的程序，所以语言必须设计成不需要太多外围的上下文环境就能理解一段语法。幸运的是，微小的、动态类型的 Lox 非常适合这种情况。

在实践中，这意味着我们的“编译器”C 模块具有你在 jlox 中认识到的解析功能——消费标识，匹配期望的标识类型，等等。而且它还具有代码生成的功能——生成字节码和向目标块中添加常量。（这也意味着我会在本章和后面的章节中交替使用“解析”和“编译”。）

我们首先分别构建解析和代码生成两个部分。然后，我们会用中间代码将它们缝合在一起，该代码使用 Pratt 的技术来解析 Lox 的语法并输出正确的字节码。

## 17.2 解析标识

首先是编译器的前半部分。这个函数的名字听起来应该很熟悉。
_<u>compiler.c，添加代码：</u>_

```c
#include "scanner.h"
// 新增部分开始
static void advance() {
  parser.previous = parser.current;

  for (;;) {
    parser.current = scanToken();
    if (parser.current.type != TOKEN_ERROR) break;

    errorAtCurrent(parser.current.start);
  }
}
// 新增部分结束
```

就像在 jlox 中一样，该函数向前通过标识流。它会向扫描器请求下一个词法标识，并将其存储起来以供后面使用。在此之前，它会获取旧的`current`标识，并将其存储在`previous`字段中。这在以后会派上用场，让我们可以在匹配到标识之后获得词素。

读取下一个标识的代码被包在一个循环中。记住，clox 的扫描器不会报告词法错误。相反地，它创建了一个特殊的*错误标识*，让解析器来报告这些错误。我们这里就是这样做的。

我们不断地循环，读取标识并报告错误，直到遇到一个没有错误的标识或者到达标识流终点。这样一来，解析器的其它部分只能看到有效的标记。当前和之前的标记被存储在下面的结构体中：

_<u>compiler.c，新增代码：</u>_

```c
#include "scanner.h"
// 新增部分开始
typedef struct {
  Token current;
  Token previous;
} Parser;

Parser parser;
// 新增部分结束
static void advance() {
```

就像我们在其它模块中所做的那样，我们维护一个这种结构体类型的单一全局变量，所以我们不需要在编译器中将状态从一个函数传递到另一个函数。

### 17.2.1 处理语法错误

如果扫描器交给我们一个错误标识，我们必须明确地告诉用户。这就需要使用下面的语句：

_<u>compiler.c，在变量 parser 后添加代码：</u>_

```c
static void errorAtCurrent(const char* message) {
  errorAt(&parser.current, message);
}
```

我们从当前标识中提取位置信息，以便告诉用户错误发生在哪里，并将其转发给`errorAt()`。更常见的情况是，我们会在刚刚消费的令牌的位置报告一个错误，所以我们给另一个函数取了一个更短的名字：

_<u>compiler.c，在变量 parser 后添加代码：</u>_

```c
static void error(const char* message) {
  errorAt(&parser.previous, message);
}
```

实际的工作发生在这里：

_<u>compiler.c，在变量 parser 后添加代码：</u>_

```c
static void errorAt(Token* token, const char* message) {
  fprintf(stderr, "[line %d] Error", token->line);

  if (token->type == TOKEN_EOF) {
    fprintf(stderr, " at end");
  } else if (token->type == TOKEN_ERROR) {
    // Nothing.
  } else {
    fprintf(stderr, " at '%.*s'", token->length, token->start);
  }

  fprintf(stderr, ": %s\n", message);
  parser.hadError = true;
}
```

首先，我们打印出错误发生的位置。如果词素是人类可读的，我们就尽量显示词素。然后我们打印错误信息。之后，我们设置这个`hadError`标志。该标志记录了编译过程中是否有任何错误发生。这个字段也存在于解析器结构体中。

_<u>compiler.c，在结构体 Parser 中添加代码：</u>_

```c
  Token previous;
  // 新增部分开始
  bool hadError;
  // 新增部分结束
} Parser;
```

前面我说过，如果发生错误，`compile()`应该返回`false`。现在我们可以这样做：

_<u>compiler.c，在 compile()函数中添加代码：</u>_

```c
  consume(TOKEN_EOF, "Expect end of expression.");
  // 新增部分开始
  return !parser.hadError;
  // 新增部分结束
}
```

我还要引入另一个用于错误处理的标志。我们想要避免错误的级联效应。如果用户在他们的代码中犯了一个错误，而解析器又不理解它在语法中的含义，我们不希望解析器在第一个错误之后，又抛出一大堆无意义的连带错误。

我们在 jlox 中使用紧急模式错误恢复来解决这个问题。在 Java 解释器中，我们抛出一个异常，跳出解析器代码直到可以跳过标识并重新同步。我们在 C 语言中没有异常[^3]。相反，我们会做一些欺骗性行为。我们添加一个标志来跟踪当前是否在紧急模式中。

_<u>compiler.c，在结构体 Parser 中添加代码：</u>_

```c
  bool hadError;
  // 新增部分开始
  bool panicMode;
  // 新增部分结束
} Parser;
```

当出现错误时，我们为其赋值。

_<u>compiler.c，在 errorAt()方法中添加代码：</u>_

```c
static void errorAt(Token* token, const char* message) {
  // 新增部分开始
  parser.panicMode = true;
  // 新增部分结束
  fprintf(stderr, "[line %d] Error", token->line);
```

之后，我们继续进行编译，就像错误从未发生过一样。字节码永远不会被执行，所以继续运行也是无害的。诀窍在于，虽然设置了紧急模式标志，但我们只是简单地屏蔽了检测到的其它错误。

_<u>compiler.c，在 errorAt()方法中添加代码：</u>_

```c
static void errorAt(Token* token, const char* message) {
  // 新增部分开始
  if (parser.panicMode) return;
  // 新增部分结束
  parser.panicMode = true;
```

There’s a good chance the parser will go off in the weeds, but the user won’t know because the errors all get swallowed. Panic mode ends when the parser reaches a synchronization point. For Lox, we chose statement boundaries, so when we later add those to our compiler, we’ll clear the flag there.

解析器很有可能会崩溃，但是用户不会知道，因为错误都会被吞掉。当解析器到达一个同步点时，紧急模式就结束了。对于 Lox，我们选择了语句作为边界，所以当我们稍后将语句添加到编译器时，将会清除该标志。

这些新字段需要被初始化。

_<u>compiler.c，在 compile()方法中添加代码：</u>_

```c
  initScanner(source);
  // 新增部分开始
  parser.hadError = false;
  parser.panicMode = false;
  // 新增部分结束
  advance();
```

为了展示这些错误，我们需要一个标准的头文件。

_<u>compiler.c，添加代码：</u>_

```c
#include <stdio.h>
// 新增部分开始
#include <stdlib.h>
// 新增部分结束
#include "common.h"
```

还有最后一个解析函数，是 jlox 中的另一个老朋友。

_<u>compiler.c，在 advance()方法后添加代码：</u>_

```c
static void consume(TokenType type, const char* message) {
  if (parser.current.type == type) {
    advance();
    return;
  }

  errorAtCurrent(message);
}
```

它类似于`advance()`，都是读取下一个标识。但它也会验证标识是否具有预期的类型。如果不是，则报告错误。这个函数是编译器中大多数语法错误的基础。

好了，关于前端的介绍就到此为止。

## 17.3 发出字节码

在我们解析并理解了用户的一段程序之后，下一步是将其转换为一系列字节码指令。它从最简单的步骤开始：向块中追加一个字节。

_<u>compiler.c，在 consume()方法后添加代码：</u>_

```c
static void emitByte(uint8_t byte) {
  writeChunk(currentChunk(), byte, parser.previous.line);
}
```

很难相信伟大的东西会流经这样一个简单的函数。它将给定的字节写入一个指令，该字节可以是操作码或操作数。它会发送前一个标记的行信息，以便将运行时错误与该行关联起来。

我们正在写入的字节码块被传递给`compile()`，但是它也需要进入`emitByte()`中。要做到这一点，我们依靠这个中间函数：

_<u>compiler.c，在变量 parser 后添加代码：</u>_

```c
Parser parser;
// 新增部分开始
Chunk* compilingChunk;

static Chunk* currentChunk() {
  return compilingChunk;
}
// 新增部分结束
static void errorAt(Token* token, const char* message) {
```

现在，chunk 指针存储在一个模块级变量中，就像我们存储其它全局状态一样。以后，当我们开始编译用户定义的函数时，“当前块”的概念会变得更加复杂。为了避免到时候需要回头修改大量代码，我把这个逻辑封装在`currentChunk()`函数中。

在写入任何字节码之前，我们先初始化这个新的模块变量：

_<u>compiler.c，在 compile()方法中添加代码：</u>_

```c
bool compile(const char* source, Chunk* chunk) {
  initScanner(source);
  // 新增部分开始
  compilingChunk = chunk;
  // 新增部分结束
  parser.hadError = false;
```

然后，在最后，当我们编译完字节码块后，对全部内容做个了结。

_<u>compiler.c，在 compile()方法中添加代码：</u>_

```c
  consume(TOKEN_EOF, "Expect end of expression.");
  // 新增部分开始
  endCompiler();
  // 新增部分结束
  return !parser.hadError;
```

会调用下面的函数：

_<u>compiler.c，在 emitByte()方法后添加代码：</u>_

```c
static void endCompiler() {
  emitReturn();
}
```

在本章中，我们的虚拟机只处理表达式。当你运行 clox 时，它会解析、编译并执行一个表达式，然后打印结果。为了打印这个值，我们暂时使用`OP_RETURN`指令。我们让编译器在块的模块添加一条这样的指令。

_<u>compiler.c，在 emitByte()方法后添加代码：</u>_

```c
static void emitReturn() {
  emitByte(OP_RETURN);
}
```

既然已经在编写后端，不妨让我们的工作更轻松一点。

_<u>compiler.c，在 emitByte()方法后添加代码：</u>_

```c
static void emitBytes(uint8_t byte1, uint8_t byte2) {
  emitByte(byte1);
  emitByte(byte2);
}
```

随着时间的推移，我们将遇到很多的情况中需要写一个操作码，后面跟一个单字节的操作数，因此值得定义这个便利的函数。

## 17.4 解析前缀表达式

我们已经组装了解析和生成代码的工具函数。缺失的部分就是将它们连接在一起的的中间代码。

![Parsing functions on the left, bytecode emitting functions on the right. What goes in the middle?](./mystery.png)

`compile()`中唯一还未实现的步骤就是这个函数：

_<u>compiler.c，在 endCompiler()方法后添加代码：</u>_

```c
static void expression() {
  // What goes here?
}
```

我们还没有准备好在 Lox 中实现每一种表达式。见鬼，我们甚至还没有布尔值。在本章中，我们只考虑四个问题：

- 数值字面量：`123`
- 用于分组的括号：`(123)`
- 一元取负：`-123`
- 算术运算四骑士：`+`、`-`、`*`、`/`

当我们通过函数编译每种类型的表达式时，我们也会对调用这些表达式的表格驱动的解析器的要求进行汇总。

### 17.4.1 标识解析器

现在，让我们把注意力集中在那些只由单个 token 组成的 Lox 表达式上。在本章中，这只包括数值字面量，但后面会有更多。下面是我们如何编译它们：

我们将每种标识类型映射到不同类型的表达式。我们为每个表达式定义一个函数，该函数会输出对应的字节码。然后我们构建一个函数指针的数组。数组中的索引对应于`TokenType`枚举值，每个索引处的函数是编译该标识类型的表达式的代码。

为了编译数值字面量，我们在数组的`TOKEN_NUMBER`索引处存储一个指向下面函数的指针，

_<u>compiler.c，在 endCompiler()方法后添加代码：</u>_

```c
static void number() {
  double value = strtod(parser.previous.start, NULL);
  emitConstant(value);
}
```

我们假定数值字面量标识已经被消耗了，并被存储在`previous`中。我们获取该词素，并使用 C 标准库将其转换为一个 double 值。然后我们用下面的函数生成加载该 double 值的字节码：

_<u>compiler.c，在 emitReturn()方法后添加代码：</u>_

```c
static void emitConstant(Value value) {
  emitBytes(OP_CONSTANT, makeConstant(value));
}
```

首先，我们将值添加到常量表中，然后我们发出一条`OP_CONSTANT`指令，在运行时将其压入栈中。要在常量表中插入一条数据，我们需要依赖：

_<u>compiler.c，在 emitReturn()方法后添加代码：</u>_

```c
static uint8_t makeConstant(Value value) {
  int constant = addConstant(currentChunk(), value);
  if (constant > UINT8_MAX) {
    error("Too many constants in one chunk.");
    return 0;
  }

  return (uint8_t)constant;
}
```

大部分的工作发生在`addConstant()`中，我们在前面的章节中定义了这个函数。它将给定的值添加到字节码块的常量表的末尾，并返回其索引。这个新函数的工作主要是确保我们没有太多常量。由于`OP_CONSTANT`指令使用单个字节来索引操作数，所以我们在一个块中最多只能存储和加载 256 个常量[^4]。

这基本就是所有的事情了。只要有了这些合适的代码，能够消耗一个`TOKEN_NUMBER`标识，在函数指针数组中查找`number()`方法，然后调用它，我们现在就可以将数值字面量编译为字节码。

### 17.4.2 括号分组

如果每个表达式只有一个标识，那我们这个尚未成型的解析函数指针数组就很好处理了。不幸的是，大多数表达式都比较长。然而，许多表达式以一个特定的标识*开始*。我们称之为*前缀*表达式。举例来说，当我们解析一个表达式，而当前标识是`(`，我们就知道当前处理的一定是一个带括号的分组表达式。

事实证明，我们的函数指针数组也能处理这些。一个表达式类型的解析函数可以消耗任何它需要的标识，就像在常规的递归下降解析器中一样。下面是小括号的工作原理：

_<u>compiler.c，在 endCompiler()方法后添加代码：</u>_

```c
static void grouping() {
  expression();
  consume(TOKEN_RIGHT_PAREN, "Expect ')' after expression.");
}
```

同样，我们假定初始的`(`已经被消耗了。我们递归地[^5]调用`expression()`来编译括号之间的表达式，然后解析结尾的`)`。

就后端而言，分组表达式实际上没有任何意义。它的唯一功能是语法上的——它允许你在需要高优先级的地方插入一个低优先级的表达式。因此，它本身没有运行时语法，也就不会发出任何字节码。对`expression()`的内部调用负责为括号内的表达式生成字节码。

### 17.4.3 一元取负

一元减号也是一个前缀表达式，因此也适用于我们的模型。

_<u>compiler.c，在 number()方法后添加代码：</u>_

```c
static void unary() {
  TokenType operatorType = parser.previous.type;

  // Compile the operand.
  expression();

  // Emit the operator instruction.
  switch (operatorType) {
    case TOKEN_MINUS: emitByte(OP_NEGATE); break;
    default: return; // Unreachable.
  }
}
```

前导的`-`标识已经被消耗掉了，并被放在`parser.previous`中。我们从中获取标识类型，以了解当前正在处理的是哪个一元运算符。现在还没必要这样做，但当下一章中我们使用这个函数来编译`!`时，这将会更有意义。

就像在`grouping()`中一样，我们会递归地调用`expression()`来编译操作数。之后，我们发出字节码执行取负运算。因为`-`出现在左边，将取负指令放在其操作数的*后面*似乎有点奇怪，但是从执行顺序的角度来考虑：

1. 首先计算操作数，并将其值留在堆栈中。
2. 然后弹出该值，对其取负，并将结果压入栈中。

所以`OP_NEGATE`指令应该是最后发出的[^6]。这也是编译器工作的一部分——按照源代码中的顺序对程序进行解析，并按照执行的顺序对其重新排序。

不过，这段代码有一个问题。它所调用的`expression()`函数会解析操作数中的任何表达式，而不考虑优先级。一旦我们加入二元运算符和其它语法，就会出错。考虑一下：

```c
-a.b + c;
```

在这里`-`的操作数应该只是`a.b`表达式，而不是整个`a.b+c`。但如果`unary()`调用`expression()`，后者会愉快地处理包括`+`在内的所有剩余代码。它会错误地把`-`视为比`+`的优先级低。

当解析一元`-`的操作数时，只需要编译具有某一优先级或更高优先级的表达式。在 jlox 的递归下降解析器中，我们通过调用我们想要允许的最低优先级的表达式的解析方法（在本例中是`call()`）来实现这一点。每个解析特定表达式的方法也会解析任何优先级更高的表达式，也就是包括优先级表的其余部分。

clox 中的`number()`和`unary()`这样的解析函数是不同的。每个函数只解析一种类型的表达式。它们不会级联处理更高优先级的表达式类型。我们需要一个不同的解决方案，看起来是这样的：

_<u>compiler.c，在 unary()方法后添加代码：</u>_

```c
static void parsePrecedence(Precedence precedence) {
  // What goes here?
}
```

这个函数（一旦实现）从当前的标识开始，解析给定优先级或更高优先级的任何表达式。在编写这个函数的主体之前，我们还有一些其它的设置要完成，但你可能也猜得到，它会使用我一直在谈论的解析函数指针列表。现在，还不用太担心它的如何工作的。为了把“优先级”作为一个参数，我们用数值来定义它。

_<u>compiler.c，在结构体 Parser 后添加代码：</u>_

```c
} Parser;
// 新增部分开始
typedef enum {
  PREC_NONE,
  PREC_ASSIGNMENT,  // =
  PREC_OR,          // or
  PREC_AND,         // and
  PREC_EQUALITY,    // == !=
  PREC_COMPARISON,  // < > <= >=
  PREC_TERM,        // + -
  PREC_FACTOR,      // * /
  PREC_UNARY,       // ! -
  PREC_CALL,        // . ()
  PREC_PRIMARY
} Precedence;
// 新增部分结束
Parser parser;
```

这些是 Lox 中的所有优先级，按照从低到高的顺序排列。由于 C 语言会隐式地为枚举赋值连续递增的数字，这就意味着`PREC_CALL`在数值上比`PREC_UNARY`要大。举例来说，假设编译器正在处理这样的代码：

```c
-a.b + c
```

如果我们调用`parsePrecedence(PREC_ASSIGNMENT)`，那么它就会解析整个表达式，因为`+`的优先级高于赋值。如果我们调用`parsePrecedence(PREC_UNARY)`，它就会编译`-a.b`并停止。它不会径直解析`+`，因为加法的优先级比一元取负运算符要低。

有了这个函数，我们就可以轻松地填充`expression()`的缺失部分。

_<u>compiler.c，在 expression()方法中替换 1 行：</u>_

```c
static void expression() {
  // 替换部分开始
  parsePrecedence(PREC_ASSIGNMENT);
  // 替换部分结束
}
```

我们只需要解析最低优先级，它也包含了所有更高优先级的表达式。现在，为了编译一元表达式的操作数，我们调用这个新函数并将其限制在适当的优先级：

_<u>compiler.c，在 unary()方法中替换 1 行：</u>_

```c
  // Compile the operand.
  // 替换部分开始
  parsePrecedence(PREC_UNARY);
  // 替换部分结束
  // Emit the operator instruction.
```

我们使用一元运算符本身的`PREC_UNARY`优先级来允许嵌套的一元表达式，如`!!doubleNegative`。因为一元运算符的优先级很高，所以正确地排除了二元运算符之类的东西。说到这一点......

## 17.5 解析中缀表达式

二元运算符与之前的表达式不同，因为它们是中缀的。对于其它表达式，我们从第一个标识就知道我们在解析什么，对于中缀表达式，只有在解析了左操作数并发现了中间的运算符时，才知道自己正在处理二元运算符。

下面是一个例子：

```c
1 + 2
```

让我们用目前已知的逻辑走一遍，试着编译一下它：

1. 我们调用`expression()`，它会进一步调用`parsePrecedence(PREC_ASSIGNMENT)`
2. 该函数（一旦实现后）会看到前面的数字标识，并意识到正在解析一个数值字面量。它将控制权交给`number()`。
3. `number()`创建一个常数，发出一个`OP_CONSTANT`指令，然后返回到`parsePrecedence()`

现在怎么办？对 `parsePrecedence()`的调用应该要消费整个加法表达式，所以它需要以某种方式继续进行解析。幸运的是，解析器就在我们需要它的地方。现在我们已经编译了前面的数字表达式，下一个标识就是`+`。这正是`parsePrecedence()`用于判断我们是否在处理中缀表达式所需的标识，并意识到我们已经编译的表达式实际上是中缀表达式的操作数。

所以，这个假定的函数指针数组，不只是列出用于解析以指定标识开头的表达式的函数。相反，这个一个函数指针的*表格*。一列将前缀解析函数与标识类型关联起来，第二列将中缀解析函数与标识类型相关联。

我们将使用下面的函数作为`TOKEN_PLUS`， `TOKEN_MINUS`，`TOKEN_STAR`和`TOKEN_SLASH` 的中缀解析函数：

_<u>compiler.c，在 endCompiler()方法后添加代码：</u>_

```c
static void binary() {
  TokenType operatorType = parser.previous.type;
  ParseRule* rule = getRule(operatorType);
  parsePrecedence((Precedence)(rule->precedence + 1));

  switch (operatorType) {
    case TOKEN_PLUS:          emitByte(OP_ADD); break;
    case TOKEN_MINUS:         emitByte(OP_SUBTRACT); break;
    case TOKEN_STAR:          emitByte(OP_MULTIPLY); break;
    case TOKEN_SLASH:         emitByte(OP_DIVIDE); break;
    default: return; // Unreachable.
  }
}
```

当前缀解析函数被调用时，前缀标识已经被消耗了。中缀解析函数被调用时，情况更进一步——整个左操作数已经被编译，而随后的中缀操作符也已经被消耗掉。

首先左操作数已经被编译的事实是很好的。这意味着在运行时，其代码已经被执行了。当它运行时，它产生的值最终进入栈中。而这正是中缀操作符需要它的地方。

然后我们使用`binary()`来处理算术操作符的其余部分。这个函数会编译右边的操作数，就像`unary()`编译自己的尾操作数那样。最后，它会发出执行对应二元运算的字节码指令。

当运行时，虚拟机会按顺序执行左、右操作数的代码，将它们的值留在栈上。然后它会执行操作符的指令。这时，会从栈中弹出这两个值，计算结果，并将结果推入栈中。

这里可能会引起你注意的代码是`getRule()`这一行。当我们解析右操作数时，我们又一次需要考虑优先级的问题。以下面这个表达式为例：

```c
2 * 3 + 4
```

当我们解析`*`表达式的右操作数时，我们只需要获取`3`，而不是`3+4`，因为`+`的优先级比`*`低。我们可以为每个二元运算符定义一个单独的函数。每个函数都会调用 `parsePrecedence()` 并传入正确的优先级来解析其操作数。

但这有点乏味。每个二元运算符的右操作数的优先级都比自己高一级[^7]。我们可以通过`getRule()`动态地查找，我们很快就会讲到。有了它，我们就可以使用比当前运算符高一级的优先级来调用`parsePrecedence()`。

这样，我们就可以对所有的二元运算符使用同一个`binary()`函数，即使它们的优先级各不相同。

## 17.6 Pratt 解析器

现在我们已经排列好了编译器的所有部分。对于每个语法生成式都有对应的函数：`number()`，`grouping()`，`unary()` 和 `binary()`。我们仍然需要实现 `parsePrecedence()`和`getRule()`。我们还知道，我们需要一个表格，给定一个标识类型，可以从中找到：

- 编译以该类型标识为起点的前缀表达式的函数
- 编译一个左操作数后跟该类型标识的中缀表达式的函数，以及
- 使用该标识作为操作符的中缀表达式的优先级[^8]

我们将这三个属性封装在一个小结构体中[^9]，该结构体表示解析器表格中的一行。

_<u>compiler.c，在枚举 Precedence 后添加代码：</u>_

```c
} Precedence;
// 新增部分开始
typedef struct {
  ParseFn prefix;
  ParseFn infix;
  Precedence precedence;
} ParseRule;
// 新增部分结束
Parser parser;
```

这个 ParseFn 类型是一个简单的函数类型定义，这类函数不需要任何参数且不返回任何内容。

_<u>compiler.c，在枚举 Precedence 后添加代码：</u>_

```c
} Precedence;
// 新增部分开始
typedef void (*ParseFn)();
// 新增部分结束
typedef struct {
```

驱动整个解析器的表格是一个 ParserRule 的数组。我们讨论了这么久，现在你终于可以看到它了[^10]。

_<u>compiler.c，在 unary()方法后添加代码：</u>_

```c
ParseRule rules[] = {
  [TOKEN_LEFT_PAREN]    = {grouping, NULL,   PREC_NONE},
  [TOKEN_RIGHT_PAREN]   = {NULL,     NULL,   PREC_NONE},
  [TOKEN_LEFT_BRACE]    = {NULL,     NULL,   PREC_NONE},
  [TOKEN_RIGHT_BRACE]   = {NULL,     NULL,   PREC_NONE},
  [TOKEN_COMMA]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_DOT]           = {NULL,     NULL,   PREC_NONE},
  [TOKEN_MINUS]         = {unary,    binary, PREC_TERM},
  [TOKEN_PLUS]          = {NULL,     binary, PREC_TERM},
  [TOKEN_SEMICOLON]     = {NULL,     NULL,   PREC_NONE},
  [TOKEN_SLASH]         = {NULL,     binary, PREC_FACTOR},
  [TOKEN_STAR]          = {NULL,     binary, PREC_FACTOR},
  [TOKEN_BANG]          = {NULL,     NULL,   PREC_NONE},
  [TOKEN_BANG_EQUAL]    = {NULL,     NULL,   PREC_NONE},
  [TOKEN_EQUAL]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_EQUAL_EQUAL]   = {NULL,     NULL,   PREC_NONE},
  [TOKEN_GREATER]       = {NULL,     NULL,   PREC_NONE},
  [TOKEN_GREATER_EQUAL] = {NULL,     NULL,   PREC_NONE},
  [TOKEN_LESS]          = {NULL,     NULL,   PREC_NONE},
  [TOKEN_LESS_EQUAL]    = {NULL,     NULL,   PREC_NONE},
  [TOKEN_IDENTIFIER]    = {NULL,     NULL,   PREC_NONE},
  [TOKEN_STRING]        = {NULL,     NULL,   PREC_NONE},
  [TOKEN_NUMBER]        = {number,   NULL,   PREC_NONE},
  [TOKEN_AND]           = {NULL,     NULL,   PREC_NONE},
  [TOKEN_CLASS]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_ELSE]          = {NULL,     NULL,   PREC_NONE},
  [TOKEN_FALSE]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_FOR]           = {NULL,     NULL,   PREC_NONE},
  [TOKEN_FUN]           = {NULL,     NULL,   PREC_NONE},
  [TOKEN_IF]            = {NULL,     NULL,   PREC_NONE},
  [TOKEN_NIL]           = {NULL,     NULL,   PREC_NONE},
  [TOKEN_OR]            = {NULL,     NULL,   PREC_NONE},
  [TOKEN_PRINT]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_RETURN]        = {NULL,     NULL,   PREC_NONE},
  [TOKEN_SUPER]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_THIS]          = {NULL,     NULL,   PREC_NONE},
  [TOKEN_TRUE]          = {NULL,     NULL,   PREC_NONE},
  [TOKEN_VAR]           = {NULL,     NULL,   PREC_NONE},
  [TOKEN_WHILE]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_ERROR]         = {NULL,     NULL,   PREC_NONE},
  [TOKEN_EOF]           = {NULL,     NULL,   PREC_NONE},
};
```

你可以看到`grouping`和`unary`是如何被插入到它们各自标识类型对应的前缀解析器列中的。在下一列中，`binary`被连接到四个算术中缀操作符上。这些中缀操作符的优先级也设置在最后一列。

除此之外，表格的其余部分都是`NULL`和`PREC_NONE`。这些空的单元格中大部分是因为没有与这些标识相关联的表达式。比如说，你不能用`else`作为表达式开头，而`}`如果作为中缀操作符也会变得很混乱。

但是，我们还没有填入整个语法。在后面的章节中，当我们添加新的表达式类型时，其中一些槽会插入函数。我喜欢这种解析方法的一点是，它使我们很容易看到哪些标识被语法使用，以及哪些标识是可用的。

Now that we have the table, we are finally ready to write the code that uses it. This is where our Pratt parser comes to life. The easiest function to define is `getRule()`.

我们现在有了这个表格，终于准备好编写使用它的代码了。这就是我们的 Pratt 解析器发挥作用的地方。最容易定义的函数是`getRule()`。

_<u>compiler.c，在 parsePrecedence()方法后添加代码：</u>_

```c
static ParseRule* getRule(TokenType type) {
  return &rules[type];
}
```

它只是简单地返回指定索引处的规则。`binary()`调用该函数来查询当前操作符的优先级。这个函数的存在只是为了处理 C 代码中的声明循环。`binary()`在规则表之前定义，以便规则表中可以存储指向它的指针。这也就意味着`binary()`的函数体不能直接访问表格。

相反地，我们将查询封装在一个函数中。这样我们可以在`binary()`函数定义之前声明`getRule()`，然后在表格之后*定义*`getRule()`。我们还需要一些其它的前置声明来处理语法的递归，所以让我们一次性全部理出来。

_<u>compiler.c，在 endCompiler()方法后添加代码：</u>_

```c
  emitReturn();
}
// 新增部分开始
static void expression();
static ParseRule* getRule(TokenType type);
static void parsePrecedence(Precedence precedence);
// 新增部分结束
static void binary() {
```

如果你正在跟随本文实现自己的 clox，请密切注意那些告诉你代码片段应该加在哪里的小注释。不过不用担心，如果你弄错了，C 编译器会很乐意告诉你。

### 17.6.1 带优先级解析

现在，我们要开始做有趣的事情了。我们定义的所有解析函数的协调者是 `parsePrecedence()`。让我们从解析前缀表达式开始。

_<u>compiler.c，在 parsePrecedence()方法中替换一行：</u>_

```c
static void parsePrecedence(Precedence precedence) {
  // 替换部分开始
  advance();
  ParseFn prefixRule = getRule(parser.previous.type)->prefix;
  if (prefixRule == NULL) {
    error("Expect expression.");
    return;
  }

  prefixRule();
  // 替换部分结束
}
```

我们读取下一个标识并查找对应的 ParseRule。如果没有前缀解析器，那么这个标识一定是语法错误。我们会报告这个错误并返回给调用方。

否则，我们就调用前缀解析函数，让它做自己的事情。该前缀解析器会编译表达式的其余部分，消耗它需要的任何其它标识，然后返回这里。中缀表达式是比较有趣的地方，因为优先级开始发挥作用了。这个实现非常简单。
_<u>compiler.c，在 parsePrecedence()方法中添加代码：</u>_

```c
  prefixRule();
  // 新增部分开始
  while (precedence <= getRule(parser.current.type)->precedence) {
    advance();
    ParseFn infixRule = getRule(parser.previous.type)->infix;
    infixRule();
  }
  // 新增部分结束
}
```

这就是全部内容了，真的。下面是整个函数的工作原理：在`parsePrecedence()`的开头，我们会为当前标识查找对应的前缀解析器。根据定义，第一个标识*总是*属于某种前缀表达式。它可能作为一个操作数嵌套在一个或多个中缀表达式中，但是当你从左到右阅读代码时，你碰到的第一个标识总是属于一个前缀表达式。

解析之后（可能会消耗更多的标识），前缀表达式就完成了。现在我们要为下一个标识寻找一个中缀解析器。如果我们找到了，就意味着我们刚刚编译的前缀表达式可能是它的一个操作数。但前提是调用 `parsePrecedence()` 时传入的`precedence`允许该中缀操作符。

如果下一个标识的优先级太低，或者根本不是一个中缀操作符，我们就结束了。我们已经尽可能多地解析了表达式。否则，我们就消耗操作符，并将控制权移交给我们发现的中缀解析器。它会消耗所需要的其它标识（通常是右操作数）并返回到`parsePrecedence()`。然后我们再次循环，并查看*下一个*标识符是否也是一个有效的中缀操作符，且该操作符可以把前面的整个表达式作为其操作数。我们就这样一直循环下去，直到遇见一个不是中缀操作符或优先级太低的标识，然后停止。

这是一篇冗长的文章，但是如果你真的想与 Vaughan Pratt 心意相通，完全理解这个算法，你可以让解析器处理一些表达式，然后在调试器中逐步查看解析器。也许图片会有帮助，只有少数几个函数，但它们奇妙地交织在一起[^11]。

![The various parsing functions and how they call each other.](./connections.png)

稍后，我们在处理赋值的时候需要调整本章中的代码。但是，除此之外，我们所写的内容涵盖了本书中其余部分所有表达式编译的需求。在添加新的表达式类型时，我们会在表格中插入额外的解析函数，但是 `parsePrecedence()` 是完整的。

## 17.7 转储字节码块

既然我们已经进入了编译器的核心，我们就应该加入一些工具。为了有助于调试生成的字节码，我们会增加对编译器完成后转储字节码块的支持。在之前我们手工编写字节码块时，进行了一些临时的日志记录。现在，我们要填入一些实际的代码，以便我们可以随时启用它。

因为这不是为终端用户准备的，所以我们把它隐藏在一个标志后面。

_<u>common.h，添加代码：</u>_

```c
#include <stdint.h>
// 新增部分开始
#define DEBUG_PRINT_CODE
// 新增部分结束
#define DEBUG_TRACE_EXECUTION
```

当这个标志被定义后，我们使用现有的“debug”模块打印出块中的字节码。

_<u>compiler.c，在 endCompiler()方法中添加代码：</u>_

```c
  emitReturn();
// 新增部分开始
#ifdef DEBUG_PRINT_CODE
  if (!parser.hadError) {
    disassembleChunk(currentChunk(), "code");
  }
#endif
// 新增部分结束
}
```

只有在代码没有错误的情况下，我们才会这样做。在出现语法错误后，编译器会继续运行，但它会处于一种奇怪的状态，可能会产生错误的代码。不过这是无害的，因为它不会被执行，但如果我们试图阅读它，只会把我们弄糊涂。

最后，为了访问`disassembleChunk()`，我们需要包含它的头文件。

_<u>compiler.c，添加代码：</u>_

```c
#include "scanner.h"
// 新增部分开始
#ifdef DEBUG_PRINT_CODE
#include "debug.h"
#endif
// 新增部分结束
typedef struct {
```

我们成功了！这是我们的虚拟机的编译和执行管道中需要安装的最后一个主要部分。我们的解释器*看起来*不大，但它内部有扫描、解析、编译字节码并执行。

启动虚拟机，输入一个表达式。如果我们所有操作都正确，它应该会计算并打印结果。我们现在有了一个过度设计的算术计算器。在接下来的章节中，我们还好添加很多语言特性，但是基础已经准备好了。

[^1]: 如果你对这一章不感兴趣，而你又希望从另一个角度了解这些概念，我写过一篇文章讲授了同样的算法，但使用了 Java 和面向对象的风格：[“Pratt Parsing: Expression Parsing Made Easy”](http://journal.stuffwithstuff.com/2011/03/19/pratt-parsers-expression-parsing-made-easy/)
[^2]: 事实上，大多数复杂的优化编译器都不止两遍执行过程。不仅要确定需要进行哪些优化，还要确定如何安排它们的顺序——因为优化往往以复杂的方式相互作用——这是介于“开放的研究领域”和“黑暗的艺术”之间的问题。
[^3]: 有`setjmp()`和`longjmp()`，但我不想使用它们。这些使我们很容易泄漏内存、忘记维护不变量，或者说寝食难安。
[^4]: 确实，这个限制是很低的。如果这是一个完整的语言实现，我们应该添加另一个指令，比如`OP_CONSTANT_16`，将索引存储为两字节的操作数，这样就可以在需要时处理更多的常量。支持这个指令的代码不是特别有启发性，所以我在 clox 中省略了它，但你会希望你的虚拟机能够扩展成更大的程序。
[^5]: Pratt 解析器不是递归下降解析器，但它仍然是递归的。这是意料之中的，因为语法本身是递归的。
[^6]: 在操作数之后发出`OP_NEGATE`确实意味着写入字节码时的当前标识不是`-`标识。但这并不重要，除了我们使用标识中的行号与指令相关联。这意味着，如果你有一个多行的取负表达式，比如<BR>![image-20220620180540620](./image-20220620180540620.png) <BR>那么运行时错误会报告在错误的代码行上。这里，它将在第 2 行显示错误，而`-`是在第一行。一个更稳健的方法是在编译器操作数之前存储标识中的行号，然后将其传递给`emitByte()`，当我想在本书中尽量保持简单。
[^7]: 我们对右操作数使用高一级的优先级，因为二元操作符是左结合的。给出一系列相同的运算符，如：<br>`1+2+3+4`<br>我们想这样解析它：<br>`((1+2)+3)+4`<br>因此，当解析第一个`+`的右侧操作数时，我们希望消耗`2`，但不消耗其余部分，所以我们使用比`+`高一个优先级的操作数。但如果我们的操作符是右结合的，这就错了。考虑一下：<br>`a=b=c=d`<br>因为赋值是右结合的，我们希望将其解析为：<br>`a=(b=(c=d))`<br>为了实现这一点，我们会使用与当前操作符*相同*的优先级来调用`parsePrecedence()`。
[^8]: 我们不需要跟踪以指定标识开头的前缀表达式的优先级，因为 Lox 中的所有前缀操作符都有相同的优先级。
[^9]: C 语言中函数指针类型的语法非常糟糕，所以我总是把它隐藏在类型定义之后。我理解这种语法背后的意图——整个“声明反映使用”之类的——但我认为这是一个失败的语法实验。
[^10]: 现在明白我所说的“不想每次需要新列时都重新审视这个表格”是什么意思了吧？这就是个野兽。也许你没有见过 C 语言数组字面量中的`[TOKEN_DOT]=`语法，这是 C99 指定的初始化器语法。这比手动计算数组索引要清楚得多。
[^11]: ![A solid arrow.](./calls.png)箭头连接一个函数与其直接调用的另一个函数，![An open arrow.](./points-to.png)箭头连接表格中的指针与解析函数。

---

## 习题

1. 要真正理解解析器，你需要查看执行线程如何通过有趣的解析函数——`parsePrecedence()`和表格中的解析器函数。以这个（奇怪的）表达式为例：

   ```c
   (-1 + 2) * 3 - -4
   ```

   写一下关于这些函数如何被调用的追踪信息。显示它们被调用的顺序，哪个调用哪个，以及传递给它们的参数。

2. `TOKEN_MINUS`的 ParseRule 行同时具有前缀和中缀函数指针。这是因为`-`既是前缀操作符（一元取负），也是一个中缀操作符（减法）。

   在完整的 Lox 语言中，还有哪些标识可以同时用于前缀和中缀位置？在 C 语言或你选择的其它语言中呢？

3. 你可能会好奇负责的“多元”表达式，他有两个以上的操作数，操作数之间由标识分开。C 语言中的条件运算符或“三元”运算符`?:`就是一个广为人知的多元操作符。

   向编译器中添加对该运算符的支持。你不需要生成任何字节码，只需要展示如何将其连接到解析器中并处理操作数。

---

## 设计笔记：只是解析

我在这里要提出一个主张，这个主张可能不被一些编译器和语言人士所欢迎。如果你不同意也没关系。就我个人而言，比起几页的限定词和含糊其辞，从那些我不同意的强烈的观点中学习到的东西更多。我的主张是，解析并不重要。

多年来，许多从事编程语言的人，尤其是在学术界，确实是真正地深入了解析器，并且非常认真地对待它们[^12]。最初，是编译器研究者，他们深入研究编译器的编译器、LALR，以及其它类似的东西。龙书的前半部分就是写给对解析器生成器好奇的人的一封长信。

后来，函数式编程人员开始研究解析器组合子、packrat 解析器和其它类型的东西。原因很明显，如果你给函数式程序员提出一个问题，他们要做的第一件事就是拿出一堆高阶函数。

在数学和算法分析领域，长期以来一直在研究证明各种解析技术的时间和内存使用情况，将解析问题转换为其它问题，并为不同的语法进行复杂性分类。

在某种程度上，这些东西很重要。如果你正在实现一门语言，你希望能够确保你的解析器复杂度不会是指数级，不会花费 7000 年时间来解析语法中的一个奇怪的边界情况。解析器理论给了你这种约束。作为一项智力练习，学习解析技术也是很有趣和有意义的。

但是，如果你的目标只是实现一门语言并将其送到用户面前，那么几乎所有这些都不重要了。你很容易被那些对语言感兴趣的人们的热情所感染，认为你的前端*需要*一些快速生成的解析器组合子工厂之类的东西。我见过人们花费大量的时间，使用当下最热门的库或技术，编写或重写他们的解析器。

这些时间并不会给用户的生活带来任何价值。如果你只是想完成解析器，那么可以选择一个普通的标准技术，使用它，然后继续前进。递归下降法，Pratt 解析和流行的解析器生成器（如 ANTLR 或 Bison）都很不错。

把你不用重写解析代码而节省下来的额外时间，花在改进编译器向用户显示的编译错误信息上。对用户来说，良好的错误处理和报告比你在语言前端投入时间所做的几乎任何事情都更有价值。

[^12]: 我们所有人都有这样的毛病：“当你只有一把锤子时，一切看起来都像是钉子”，但也许没有人向编译器人员那样明显。你不会相信，只要你向编译器黑客寻求帮助，在他们的解决方案中有那么多的软件问题需要一种新的小语言来解决。<br>Yacc 和其它编译器的编译器是最令人愉快的递归示例。“哇，写编译器是一件苦差事。我知道，让我们写一个编译器来为我们编写编译器吧”。<br>郑重声明一下，我对这种疾病并没有免疫力。
