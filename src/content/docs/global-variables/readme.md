---
title: 21. 全局变量
description: Global Variables
---

> 如果有一种发明能把一段记忆装进瓶子里就好了，像香味一样。它永远不会褪色，也不会变质。然后，当一个人想要的时候，可以打开瓶塞，就像重新活在那个时刻一样。
>
> ​ —— Daphne du Maurier, _Rebecca_

[上一章](../../hash-tables/readme/)对一个大的、深入的、基本的计算机科学数据结构进行了长时间的探索。偏重理论和概念。可能有一些关于大 O 符号和算法的讨论。这一章没有那么多知识分子的自吹自擂。没有什么伟大的思想需要学习。相反，它是一些简单的工程任务。一旦我们完成了这些任务，我们的虚拟机就可以支持变量。

事实上，它将只支持*全局*变量。局部变量将在下一章中支持。在 jlox 中，我们设法将它们塞进了一个章节，因为我们对所有变量都使用了相同的实现技术。我们建立了一个环境链，每个作用域都有一个，一直到顶部作用域。这是学习如何管理状态的一种简单、干净的方法。

但它也很慢。每次进入一个代码块或调用一个函数时，都要分配一个新的哈希表，这不是通往快速虚拟机的道路。鉴于很多代码都与使用变量有关，如果变量操作缓慢，一切都会变慢。对于 clox，我们会通过对局部变量使用更有效的策略来改善这一点，但全局变量不那么容易优化[^1]。

This is a common meta-strategy in sophisticated language implementations. Often, the same language feature will have multiple implementation techniques, each tuned for different use patterns. For example, JavaScript VMs often have a faster representation for objects that are used more like instances of classes compared to other objects whose set of properties is more freely modified. C and C++ compilers usually have a variety of ways to compile `switch` statements based on the number of cases and how densely packed the case values are.

快速复习一下 Lox 语义：Lox 中的全局变量是“后期绑定”的，或者说是动态解析的。这意味着，你可以在全局变量被定义之前，编译引用它的一大块代码。只要代码在定义发生之前没有执行，就没有问题。在实践中，这意味着你可以在函数的主体中引用后面的变量。

```c
fun showVariable() {
  print global;
}

var global = "after";
showVariable();
```

这样的代码可能看起来很奇怪，但它对于定义相互递归的函数很方便。它与 REPL 的配合也更好。你可以在一行中编写一个小函数，然后在下一行中定义它使用的变量。

局部变量的工作方式不同。因为局部变量的声明总是发生在使用之前，虚拟机可以在编译时解析它们，即使是在简单的单遍编译器中。这让我们可以为局部变量使用更聪明的表示形式。但这是下一章的内容。现在，我们只考虑全局变量。

## 21.1 语句

变量是通过变量声明产生的，这意味着现在是时候向编译器中添加对语句的支持了。如果你还记得的话，Lox 将语句分为两类。“声明”是那些将一个新名称与值绑定的语句。其它类型的语句——控制流、打印等——只被称为“语句”。我们不允许在控制流语句中直接使用声明，像这样：

```c
if (monday) var croissant = "yes"; // Error.
```

允许这种做法会引发围绕变量作用域的令人困惑的问题。因此，像其它语言一样，对于允许出现在控制流主体内的语句子集，我们制定单独的语法规则，从而禁止这种做法。

```c
statement      → exprStmt
               | forStmt
               | ifStmt
               | printStmt
               | returnStmt
               | whileStmt
               | block ;
```

然后，我们为脚本的顶层和代码块内部使用单独的规则。

```c
declaration    → classDecl
               | funDecl
               | varDecl
               | statement ;
```

`declaration`包含声明名称的语句，也包含`statement`规则，这样所有的语句类型都是允许的。因为`block`本身就在`statement`中，你可以通过将声明嵌套在代码块中的方式将它们放在控制流结构中[^2]。

在本章中，我们只讨论几个语句和一个声明。

```c
statement      → exprStmt
               | printStmt ;

declaration    → varDecl
               | statement ;
```

到目前为止，我们的虚拟机都认为“程序”是一个表达式，因为我们只能解析和编译一条表达式。在完整的 Lox 实现中，程序是一连串的声明。我们现在已经准备要支持它了。

_<u>compiler.c，在 compile()方法中替换 2 行：</u>_

```c
  advance();
  // 替换部分开始
  while (!match(TOKEN_EOF)) {
    declaration();
  }
  // 替换部分结束
  endCompiler();
```

我们会一直编译声明语句，直到到达源文件的结尾。我们用这个方法来编译一条声明语句：

_<u>compiler.c，在 expression()方法后添加代码：</u>_

```c
static void declaration() {
  statement();
}
```

我们将在本章后面讨论变量声明，所以现在，我们直接使用`statement()`。

_<u>compiler.c，在 declaration()方法后添加代码：</u>_

```c
static void statement() {
  if (match(TOKEN_PRINT)) {
    printStatement();
  }
}
```

代码块可以包含声明，而控制流语句可以包含其它语句。这意味着这两个函数最终是递归的。我们不妨现在就把前置声明写出来。

_<u>compiler.c，在 expression()方法后添加代码：</u>_

```c
static void expression();
// 新增部分开始
static void statement();
static void declaration();
// 新增部分结束
static ParseRule* getRule(TokenType type);
```

### 21.1.1 Print 语句

在本章中，我们有两种语句类型需要支持。我们从`print`语句开始，它自然是以`print`标识开头的。我们使用这个辅助函数来检测：

_<u>compiler.c，在 consume()方法后添加代码：</u>_

```c
static bool match(TokenType type) {
  if (!check(type)) return false;
  advance();
  return true;
}
```

你可能看出它是从 jlox 来的。如果当前的标识是指定类型，我们就消耗该标识并返回`true`。否则，我们就不处理该标识并返回`false`。这个辅助函数是通过另一个辅助函数实现的：

_<u>compiler.c，在 consume()方法后添加代码：</u>_

```c
static bool check(TokenType type) {
  return parser.current.type == type;
}
```

如果当前标识符合给定的类型，`check()`函数返回`true`。将它封装在一个函数中似乎有点傻，但我们以后会更多地使用它，而且我们认为像这样简短的动词命名的函数使解析器更容易阅读[^3]。

如果我们确实匹配到了`print`标识，那么我们在下面这个方法中编译该语句的剩余部分：

_<u>compiler.c，在 expression()方法后添加代码：</u>_

```c
static void printStatement() {
  expression();
  consume(TOKEN_SEMICOLON, "Expect ';' after value.");
  emitByte(OP_PRINT);
}
```

`print`语句会对表达式求值并打印出结果，所以我们首先解析并编译这个表达式。语法要求在表达式之后有一个分号，所以我们消耗一个分号标识。最后，我们生成一条新指令来打印结果。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_NEGATE,
  // 新增部分开始
  OP_PRINT,
  // 新增部分结束
  OP_RETURN,
```

在运行时，我们这样执行这条指令：

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        break;
      // 新增部分开始
      case OP_PRINT: {
        printValue(pop());
        printf("\n");
        break;
      }
      // 新增部分结束
      case OP_RETURN: {
```

当解释器到达这条指令时，它已经执行了表达式的代码，将结果值留在了栈顶。现在我们只需要弹出该值并打印。

请注意，在此之后我们不会再向栈中压入任何内容。这是虚拟机中表达式和语句之间的一个关键区别。每个字节码指令都有**堆栈效应**，这个值用于描述指令如何修改堆栈内容。例如，`OP_ADD`会弹出两个值并压入一个值，使得栈中比之前少了一个元素[^4]。

你可以把一系列指令的堆栈效应相加，得到它们的总体效应。如果把从任何一个完整的表达式中编译得到的一系列指令的堆栈效应相加，其总数是 1。每个表达式会在栈中留下一个结果值。

整个语句对应字节码的总堆栈效应为 0。因为语句不产生任何值，所以它最终会保持堆栈不变，尽管它在执行自己的操作时难免会使用堆栈。这一点很重要，因为等我们涉及到控制流和循环时，一个程序可能会执行一长串的语句。如果每条语句都增加或减少堆栈，最终就可能会溢出或下溢。

在解释器循环中，我们应该删除一些代码。

_<u>vm.c，在 run()方法中替换 2 行：</u>_

```c
      case OP_RETURN: {
        // 替换部分开始
        // Exit interpreter.
        // 替换部分结束
        return INTERPRET_OK;
```

当虚拟机只编译和计算一条表达式时，我们在`OP_RETURN`中使用一些临时代码来输出值。现在我们已经有了语句和`print`，就不再需要这些了。我们离 clox 的完全实现又近了一步[^5]。

像往常一样，一条新指令需要反汇编程序的支持。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return simpleInstruction("OP_NEGATE", offset);
    // 新增部分开始
    case OP_PRINT:
      return simpleInstruction("OP_PRINT", offset);
    // 新增部分结束
    case OP_RETURN:
```

这就是我们的`print`语句。如果你愿意，可以试一试：

```c
print 1 + 2;
print 3 * 4;
```

令人兴奋！好吧，也许没有那么激动人心，但是我们现在可以构建包含任意多语句的脚本，这感觉是一种进步。

### 21.1.2 表达式语句

等待，直到你看到下一条语句。如果没有看到`print`关键字，那么我们看到的一定是一条表达式语句。

_<u>compiler.c，在 statement()方法中添加代码：</u>_

```c
    printStatement();
  // 新增部分开始
  } else {
    expressionStatement();
  // 新增部分结束
  }
```

它是这样解析的：

_<u>compiler.c，在 expression()方法后添加代码：</u>_

```c
static void expressionStatement() {
  expression();
  consume(TOKEN_SEMICOLON, "Expect ';' after expression.");
  emitByte(OP_POP);
}
```

“表达式语句”就是一个表达式后面跟着一个分号。这是在需要语句的上下文中写表达式的方式。通常来说，这样你就可以调用函数或执行赋值操作以触发其副作用，像这样：

```c
brunch = "quiche";
eat(brunch);
```

从语义上说，表达式语句会对表达式求值并丢弃结果。编译器直接对这种行为进行编码。它会编译表达式，然后生成一条`OP_POP`指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_FALSE,
  // 新增部分开始
  OP_POP,
  // 新增部分结束
  OP_EQUAL,
```

顾名思义，该指令会弹出栈顶的值并将其遗弃。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      case OP_FALSE: push(BOOL_VAL(false)); break;
      // 新增部分开始
      case OP_POP: pop(); break;
      // 新增部分结束
      case OP_EQUAL: {
```

我们也可以对它进行反汇编。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return simpleInstruction("OP_FALSE", offset);
    // 新增部分开始
    case OP_POP:
      return simpleInstruction("OP_POP", offset);
    // 新增部分结束
    case OP_EQUAL:
```

表达式语句现在还不是很有用，因为我们无法创建任何有副作用的表达式，但等我们后面添加函数时，它们将是必不可少的。在像 C 这样的真正语言中，大部分语句都是表达式语句[^6]。

### 21.1.3 错误同步

当我们在编译器中完成这些初始化工作时，我们可以把前几章遗留的一个小尾巴处理一下。与 jlox 一样，clox 也使用了恐慌模式下的错误恢复来减少它所报告的级联编译错误。当编译器到达同步点时，就退出恐慌模式。对于 Lox 来说，我们选择语句边界作为同步点。现在我们有了语句，就可以实现同步了。

_<u>compiler.c，在 declaration()方法中添加代码：</u>_

```c
  statement();
  // 新增部分开始
  if (parser.panicMode) synchronize();
  // 新增部分结束
}
```

如果我们在解析前一条语句时遇到编译错误，我们就会进入恐慌模式。当这种情况发生时，我们会在这条语句之后开始同步。

_<u>compiler.c，在 printStatement()方法后添加代码：</u>_

```c
static void synchronize() {
  parser.panicMode = false;

  while (parser.current.type != TOKEN_EOF) {
    if (parser.previous.type == TOKEN_SEMICOLON) return;
    switch (parser.current.type) {
      case TOKEN_CLASS:
      case TOKEN_FUN:
      case TOKEN_VAR:
      case TOKEN_FOR:
      case TOKEN_IF:
      case TOKEN_WHILE:
      case TOKEN_PRINT:
      case TOKEN_RETURN:
        return;

      default:
        ; // Do nothing.
    }

    advance();
  }
}
```

我们会不分青红皂白地跳过标识，直到我们到达一个看起来像是语句边界的位置。我们识别边界的方式包括，查找可以结束一条语句的前驱标识，如分号；或者我们可以查找能够开始一条语句的后续标识，通常是控制流或声明语句的关键字之一。

## 21.2 变量声明

仅仅能够*打印*并不能为你的语言在编程语言博览会上赢得任何奖项，所以让我们继续做一些更有野心的事，让变量发挥作用。我们需要支持三种操作：

- 使用`var`语句声明一个新变量

- 使用标识符表达式访问一个变量的值

- 使用赋值表达式将一个新的值存储在现有的变量中

等我们有了变量以后，才能做后面两件事，所以我们从声明开始。

_<u>compiler.c，在 declaration()方法中替换 1 行：</u>_

```c
static void declaration() {
  // 替换部分开始
  if (match(TOKEN_VAR)) {
    varDeclaration();
  } else {
    statement();
  }
  // 替换部分结束
  if (parser.panicMode) synchronize();
```

我们为声明语法规则建立的占位解析函数现在已经有了实际的生成式。如果我们匹配到一个`var`标识，就跳转到这里：

_<u>compiler.c，在 expression()方法后添加代码：</u>_

```c
static void varDeclaration() {
  uint8_t global = parseVariable("Expect variable name.");

  if (match(TOKEN_EQUAL)) {
    expression();
  } else {
    emitByte(OP_NIL);
  }
  consume(TOKEN_SEMICOLON,
          "Expect ';' after variable declaration.");

  defineVariable(global);
}
```

关键字后面跟着变量名。它是由`parseVariable()`编译的，我们马上就会讲到。然后我们会寻找一个`=`，后跟初始化表达式。如果用户没有初始化变量，编译器会生成`OP_NIL`指令隐式地将其初始化为`nil`[^7]。无论哪种方式，我们都希望语句以分号结束。

这里有两个新函数用于处理变量和标识符。下面是第一个：

_<u>compiler.c，在 parsePrecedence()方法后添加代码：</u>_

```c
static void parsePrecedence(Precedence precedence);
// 新增部分开始
static uint8_t parseVariable(const char* errorMessage) {
  consume(TOKEN_IDENTIFIER, errorMessage);
  return identifierConstant(&parser.previous);
}
// 新增部分结束
```

它要求下一个标识是一个标识符，它会消耗该标识并发送到这里：

_<u>compiler.c，在 parsePrecedence()方法后添加代码：</u>_

```c
static void parsePrecedence(Precedence precedence);
// 新增部分开始
static uint8_t identifierConstant(Token* name) {
  return makeConstant(OBJ_VAL(copyString(name->start,
                                         name->length)));
}
// 新增部分结束
```

这个函数接受给定的标识，并将其词素作为一个字符串添加到字节码块的常量表中。然后，它会返回该常量在常量表中的索引。

全局变量在运行时是按*名称*查找的。这意味着虚拟机（字节码解释器循环）需要访问该名称。整个字符串太大，不能作为操作数塞进字节码流中。相反，我们将字符串存储到常量表中，然后指令通过该名称在表中的索引来引用它。

这个函数会将索引一直返回给`varDeclaration()`，随后又将其传递到这里：

_<u>compiler.c，在 parseVariable()方法后添加代码：</u>_

```c
static void defineVariable(uint8_t global) {
  emitBytes(OP_DEFINE_GLOBAL, global);
}
```

它会输出字节码指令，用于定义新变量并存储其初始化值。变量名在常量表中的索引是该指令的操作数。在基于堆栈的虚拟机中，我们通常是最后发出这条指令。在运行时，我们首先执行变量初始化器的代码，将值留在栈中。然后这条指令会获取该值并保存起来，以供日后使用[^8]。

在运行时，我们从这条新指令开始：

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_POP,
  // 新增部分开始
  OP_DEFINE_GLOBAL,
  // 新增部分结束
  OP_EQUAL,
```

多亏了我们方便的哈希表，实现起来并不太难。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      case OP_POP: pop(); break;
      // 新增部分开始
      case OP_DEFINE_GLOBAL: {
        ObjString* name = READ_STRING();
        tableSet(&vm.globals, name, peek(0));
        pop();
        break;
      }
      // 新增部分结束
      case OP_EQUAL: {
```

我们从常量表中获取变量的名称，然后我们从栈顶获取值，并以该名称为键将其存储在哈希表中[^9]。

这段代码并没有检查键是否已经在表中。Lox 对全局变量的处理非常宽松，允许你重新定义它们而且不会出错。这在 REPL 会话中很有用，如果键恰好已经在哈希表中，虚拟机通过简单地覆盖值来支持这一点。

还有另一个小的辅助宏：

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
#define READ_CONSTANT() (vm.chunk->constants.values[READ_BYTE()])
// 新增部分开始
#define READ_STRING() AS_STRING(READ_CONSTANT())
// 新增部分结束
#define BINARY_OP(valueType, op) \
```

它从字节码块中读取一个 1 字节的操作数。它将其视为字节码块的常量表的索引，并返回该索引处的字符串。它不检查该值是否是字符串——它只是不加区分地进行类型转换。这是安全的，因为编译器永远不会发出引用非字符串常量的指令。

因为我们关心词法卫生，所以在解释器函数的末尾也取消了这个宏的定义。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
#undef READ_CONSTANT
// 新增部分开始
#undef READ_STRING
// 新增部分结束
#undef BINARY_OP
```

我一直在说“哈希表”，但实际上我们还没有哈希表。我们需要一个地方来存储这些全局变量。因为我们希望它们在 clox 运行期间一直存在，所以我们将它们之间存储在虚拟机中。

_<u>vm.h，在结构体 VM 中添加代码：</u>_

```c
  Value* stackTop;
  // 新增部分开始
  Table globals;
  // 新增部分结束
  Table strings;
```

正如我们对字符串表所做的那样，我们需要在虚拟机启动时将哈希表初始化为有效状态。

_<u>vm.c，在 initVM()方法中添加代码：</u>_

```c
  vm.objects = NULL;
  // 新增部分开始
  initTable(&vm.globals);
  // 新增部分结束
  initTable(&vm.strings);
```

当我们退出时，就将其删掉[^10]。

_<u>vm.c，在 freeVM()方法中添加代码：</u>_

```c
void freeVM() {
  // 新增部分开始
  freeTable(&vm.globals);
  // 新增部分结束
  freeTable(&vm.strings);
```

跟往常一样，我们也希望能够对新指令进行反汇编。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return simpleInstruction("OP_POP", offset);
    // 新增部分开始
    case OP_DEFINE_GLOBAL:
      return constantInstruction("OP_DEFINE_GLOBAL", chunk,
                                 offset);
    // 新增部分结束
    case OP_EQUAL:
```

有了这个，我们就可以定义全局变量了。但用户并不能说他们可以定义全局变量，因为他们实际上还不能使用这些变量。所以，接下来我们解决这个问题。

## 21.3 读取变量

像所有编程语言中一样，我们使用变量的名称来访问它的值。我们在这里将标识符和表达式解析器进行挂钩：

_<u>compiler.c，替换 1 行：</u>_

```c
  [TOKEN_LESS_EQUAL]    = {NULL,     binary, PREC_COMPARISON},
  // 替换部分开始
  [TOKEN_IDENTIFIER]    = {variable, NULL,   PREC_NONE},
  // 替换部分结束
  [TOKEN_STRING]        = {string,   NULL,   PREC_NONE},
```

这里调用了这个新解析器函数：

_<u>compiler.c，在 string()方法后添加代码：</u>_

```c
static void variable() {
  namedVariable(parser.previous);
}
```

和声明一样，这里有几个小的辅助函数，现在看起来毫无意义，但在后面的章节中会变得更加有用。我保证。

_<u>compiler.c，在 string()方法后添加代码：</u>_

```c
static void namedVariable(Token name) {
  uint8_t arg = identifierConstant(&name);
  emitBytes(OP_GET_GLOBAL, arg);
}
```

这里会调用与之前相同的`identifierConstant()`函数，以获取给定的标识符标识，并将其词素作为字符串添加到字节码块的常量表中。剩下的工作就是生成一条指令，加载具有该名称的全局变量。下面是这个指令：

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_POP,
  // 新增部分开始
  OP_GET_GLOBAL,
  // 新增部分结束
  OP_DEFINE_GLOBAL,
```

在解释器中，它的实现是`OP_DEFINE_GLOBAL`的镜像操作。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      case OP_POP: pop(); break;
      // 新增部分开始
      case OP_GET_GLOBAL: {
        ObjString* name = READ_STRING();
        Value value;
        if (!tableGet(&vm.globals, name, &value)) {
          runtimeError("Undefined variable '%s'.", name->chars);
          return INTERPRET_RUNTIME_ERROR;
        }
        push(value);
        break;
      }
      // 新增部分结束
      case OP_DEFINE_GLOBAL: {
```

我们从指令操作数中提取常量表索引并获得变量名称。然后我们使用它作为键，在全局变量哈希表中查找变量的值。

如果该键不在哈希表中，就意味着这个全局变量从未被定义过。这在 Lox 中是运行时错误，所以如果发生这种情况，我们要报告错误并退出解释器循环。否则，我们获取该值并将其压入栈中。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return simpleInstruction("OP_POP", offset);
    // 新增部分开始
    case OP_GET_GLOBAL:
      return constantInstruction("OP_GET_GLOBAL", chunk, offset);
    // 新增部分结束
    case OP_DEFINE_GLOBAL:
```

稍微反汇编一下，就完成了。我们的解释器现在可以运行这样的代码了：

```ruby
var beverage = "cafe au lait";
var breakfast = "beignets with " + beverage;
print breakfast;
```

只剩一个操作了。

## 21.4 赋值

在这本书中，我一直试图让你走在一条相对安全和简单的道路上。我并不回避困难的*问题*，但是我尽量不让解决方案过于复杂。可惜的是，我们的字节码编译器中的其它设计选择使得赋值的实现变得很麻烦[^11]。

我们的字节码虚拟机使用的是单遍编译器。它在不需要任何中间 AST 的情况下，动态地解析并生成字节码。一旦它识别出某个语法，它就会生成对应的字节码。赋值操作天然不符合这一点。请考虑一下：

```c
menu.brunch(sunday).beverage = "mimosa";
```

在这段代码中，直到解析器遇见`=`（第一个`menu`之后很多个标识），它才能意识到`menu.brunch(sunday).beverage`是赋值操作的目标，而不是常规的表达式。到那时，编译器已经为整个代码生成字节码了。

不过，这个问题并不像看上去那么可怕。看看解析器是如何处理这个例子的：

![The 'menu.brunch(sunday).beverage = "mimosa"' statement, showing that 'menu.brunch(sunday)' is an expression.](./setter.png)

尽管`.beverage`部分无法被编译为一个 get 表达式，`.`左侧的其它部分是一个表达式，有着正常的表达式语义。`menu.brunch(sunday)`部分可以像往常一样编译和执行。

幸运的是，赋值语句左侧部分唯一的语义差异在于其最右侧的标识，紧挨着`=`之前。尽管 setter 的接收方可能是一个任意长的表达式，但与 get 表达式不同的部分在于尾部的标识符，它就在`=`之前。我们不需要太多的前瞻就可以意识到`beverage`应该被编译为 set 表达式而不是 getter。

变量就更简单了，因为它们在`=`之前就是一个简单的标识符。那么我们的想法是，在编译一个也可以作为赋值目标的表达式*之前*，我们会寻找随后的`=`标识。如果我们看到了，那表明我们将其一个赋值表达式或 setter 来编译，而不是变量访问或 getter。

我们还不需要考虑 setter，所以我们需要处理的就是变量。

_<u>compiler.c，在 namedVariable()方法中替换 1 行：</u>_

```c
  uint8_t arg = identifierConstant(&name);
  // 替换部分开始
  if (match(TOKEN_EQUAL)) {
    expression();
    emitBytes(OP_SET_GLOBAL, arg);
  } else {
    emitBytes(OP_GET_GLOBAL, arg);
  }
  // 替换部分结束
}
```

在标识符表达式的解析函数中，我们会查找标识符后面的等号。如果找到了，我们就不会生成变量访问的代码，我们会编译所赋的值，然后生成一个赋值指令。

这就是我们在本章中需要添加的最后一条指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_DEFINE_GLOBAL,
  // 新增部分开始
  OP_SET_GLOBAL,
  // 新增部分结束
  OP_EQUAL,
```

如你所想，它的运行时行为类似于定义一个新变量。

_<u>vm.c，在 run()方法中添加代码[^12]：</u>_

```c
      }
      // 新增部分开始
      case OP_SET_GLOBAL: {
        ObjString* name = READ_STRING();
        if (tableSet(&vm.globals, name, peek(0))) {
          tableDelete(&vm.globals, name);
          runtimeError("Undefined variable '%s'.", name->chars);
          return INTERPRET_RUNTIME_ERROR;
        }
        break;
      }
      // 新增部分结束
      case OP_EQUAL: {
```

主要的区别在于，当键在全局变量哈希表中不存在时会发生什么。如果这个变量还没有定义，对其进行赋值就是一个运行时错误。Lox 不做隐式的变量声明。

另一个区别是，设置变量并不会从栈中弹出值。记住，赋值是一个表达式，所以它需要把这个值保留在那里，以防赋值嵌套在某个更大的表达式中。

加一点反汇编代码：

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return constantInstruction("OP_DEFINE_GLOBAL", chunk,
                                 offset);
    // 新增部分开始
    case OP_SET_GLOBAL:
      return constantInstruction("OP_SET_GLOBAL", chunk, offset);
    // 新增部分结束
    case OP_EQUAL:
```

我们已经完成了，是吗？嗯……不完全是。我们犯了一个错误！看一下这个：

```c
a * b = c + d;
```

根据 Lox 语法，`=`的优先级最低，所以这大致应该解析为：

![The expected parse, like '(a * b) = (c + d)'.](./ast-good.png)

显然，`a*b`不是一个有效的赋值目标[^13]，所以这应该是一个语法错误。但我们的解析器是这样的：

1. 首先，`parsePrecedence()`使用`variable()`前缀解析器解析`a`。
2. 之后，会进入中缀解析循环。
3. 达到`*`，并调用`binary()`。
4. 递归地调用`parsePrecedence()`解析右操作数。
5. 再次调用`variable()`解析`b`。
6. 在对`variable()`的调用中，会查找尾部的`=`。它看到了，因此会将本行的其余部分解析为一个赋值表达式。

换句话说，解析器将上面的代码看作：

![The actual parse, like 'a * (b = c + d)'.](./ast-bad.png)

我们搞砸了优先级处理，因为`variable()`没有考虑包含变量的外围表达式的优先级。如果变量恰好是中缀操作符的右操作数，或者是一元操作符的操作数，那么这个包含表达式的优先级太高，不允许使用`=`。

为了解决这个问题，`variable()`应该只在低优先级表达式的上下文中寻找并使用`=`。从逻辑上讲，知道当前优先级的代码是`parsePrecedence()`。`variable()`函数不需要知道实际的级别。它只关心优先级是否低到允许赋值表达式，所以我们把这个情况以布尔值传入。

_<u>compiler.c，在 parsePrecedence()方法中替换 1 行：</u>_

```c
    error("Expect expression.");
    return;
  }
  // 替换部分开始
  bool canAssign = precedence <= PREC_ASSIGNMENT;
  prefixRule(canAssign);
  // 替换部分结束
  while (precedence <= getRule(parser.current.type)->precedence) {
```

因为赋值是最低优先级的表达式，只有在解析赋值表达式或如表达式语句等顶层表达式时，才允许出现赋值。这个标志会被传入这个解析器函数：

_<u>compiler.c，在 variable()函数中替换 3 行：</u>_

```c
static void variable(bool canAssign) {
  namedVariable(parser.previous, canAssign);
}
```

通过一个新参数透传该值：

_<u>compiler.c，在 namedVariable()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void namedVariable(Token name, bool canAssign) {
  // 替换部分结束
  uint8_t arg = identifierConstant(&name);
```

最后在这里使用它：

```
  uint8_t arg = identifierConstant(&name);
```

_<u>compiler.c，在 namedVariable()方法中替换 1 行：</u>_

```c
  uint8_t arg = identifierConstant(&name);
  // 替换部分开始
  if (canAssign && match(TOKEN_EQUAL)) {
  // 替换部分结束
    expression();
```

为了把字面上的 1 比特数据送到编译器的正确位置需要做很多工作，但它已经到达了。如果变量嵌套在某个优先级更高的表达式中，`canAssign`将为`false`，即使有`=`也会被忽略。然后`namedVariable()`返回，执行最终返回到了`parsePrecedence()`。

然后呢？编译器会对我们前面的负面例子做什么？现在，`variable()`不会消耗`=`，所以它将是当前的标识。编译器从`variable()`前缀解析器返回到`parsePrecedence()`，然后尝试进入中缀解析循环。没有与`=`相关的解析函数，因此也会跳过这个循环。

然后`parsePrecedence()`默默地返回到调用方。这也是不对的。如果`=`没有作为表达式的一部分被消耗，那么其它任何东西都不会消耗它。这是一个错误，我们应该报告它。

_<u>compiler.c，在 parsePrecedence()方法中添加代码：</u>_

```c
    infixRule();
  }
  // 新增部分开始
  if (canAssign && match(TOKEN_EQUAL)) {
    error("Invalid assignment target.");
  }
  // 新增部分结束
}
```

这样，前面的错误程序在编译时就会正确地得到一个错误。好了，现在我们完成了吗？也不尽然。看，我们正向一个解析函数传递参数。但是这些函数是存储在一个函数指令表格中的，所以所有的解析函数需要具有相同的类型。尽管大多数解析函数都不支持被用作赋值目标——setter 是唯一的一个[^14]——但我们这个友好的 C 编译器要求它们*都*接受相同的参数。

所以我们要做一些苦差事来结束这一章。首先，让我们继续前进，将标志传给中缀解析函数。

_<u>compiler.c，在 parsePrecedence()方法中替换 1 行：</u>_

```c
    ParseFn infixRule = getRule(parser.previous.type)->infix;
    // 替换部分开始
    infixRule(canAssign);
    // 替换部分结束
  }
```

我们最终会在 setter 中需要它。然后，我们要修复函数类型的类型定义。

_<u>compiler.c，在枚举 Precedence 后替换 1 行：</u>_

```c
} Precedence;
// 替换部分开始
typedef void (*ParseFn)(bool canAssign);
// 替换部分结束
typedef struct {
```

还有一些非常乏味的代码，为了在所有的现有解析函数中接受这个参数。这里：

_<u>compiler.c，在 binary()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void binary(bool canAssign) {
// 替换部分结束
  TokenType operatorType = parser.previous.type;
```

这里:

_<u>compiler.c，在 literal()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void literal(bool canAssign) {
// 替换部分结束
  switch (parser.previous.type) {
```

这里:

_<u>compiler.c，在 grouping()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void grouping(bool canAssign) {
// 替换部分结束
  expression();
```

这里:

_<u>compiler.c，在 number()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void number(bool canAssign) {
// 替换部分结束
  double value = strtod(parser.previous.start, NULL);
```

还有这里:

_<u>compiler.c，在 string()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void string(bool canAssign) {
// 替换部分结束
  emitConstant(OBJ_VAL(copyString(parser.previous.start + 1,
```

最后:

_<u>compiler.c，在 unary()方法中替换 1 行：</u>_

```c
// 替换部分开始
static void unary(bool canAssign) {
// 替换部分结束
  TokenType operatorType = parser.previous.type;
```

吁！我们又回到了可以编译的 C 程序。启动它，新增你可以运行这个：

```javascript
var breakfast = "beignets";
var beverage = "cafe au lait";
breakfast = "beignets with " + beverage;

print breakfast;
```

它开始看起来像是实际语言的真正代码了！

[^1]: 这是复杂的语言实现中常见的元策略。通常情况下，同一种语言特性会有多种实现技术，每种技术都针对不同的使用模式进行了优化。举例来说，与属性集可以自由修改的其它对象相比，Java Script 虚拟机通常对那些使用起来像类实例对象有着更快的表示形式。C 和 C++编译器通常由多种方法能够根据 case 分支数量和 case 值的密集程度来编译`switch`语句。
[^2]: 代码块的作用有点像表达式中的括号。块可以让你把“低级别的”声明语句放在只允许“高级别的”非声明语句的地方。
[^3]: 这听起来微不足道，但是非玩具型语言的手写解析器非常大。当你有数千行代码时，如果一个实用函数可以将两行代码简化为一行代码，并使结果更易于阅读，那它就很容易被接受。
[^4]: `OP_ADD`执行过后堆栈会少一个元素，所以它的效应是`-1`：![The stack effect of an OP_ADD instruction.](./stack-effect.png)
[^5]: 不过，我们只是近了一步。等我们添加函数时，还会重新审视`OP_RETURN`。现在，它退出整个解释器的循环即可。
[^6]: 据我统计，在本章末尾的`compiler.c`版本中，149 条语句中有 80 条是表达式语句。
[^7]: 基本上，编译器会对变量声明进行脱糖处理，如`var a;`变成`var a = nil;`，它为前者生成的代码和为后者生成的代码是相同的。
[^8]: 我知道这里有一些函数现在看起来没什么意义。但是，随着我们增加更多与名称相关的语言特性，我们会从中获得更多的好处。函数和类声明都声明了新的变量，而变量表达式和赋值表达式会访问它们。
[^9]: 请注意，直到将值添加到哈希表之后，我们才会弹出它。这确保了如果在将值添加到哈希表的过程中触发了垃圾回收，虚拟机仍然可以找到这个值。这显然是很可能的，因为哈希表在调整大小时需要动态分配。
[^10]: 这个进程在退出时会释放所有的东西，但要求操作系统来收拾我们的烂摊子，总感觉很不体面。
[^11]: 如果你还记得，在 jlox 中赋值是很容易的。
[^12]: 对`tableSet()`的调用会将值存储在全局变量表中，即使该变量之前没有定义。这个问题在 REPL 会话中是用户可见的，因为即使报告了运行时错误，它仍然在运行。因此，我们也要注意从表中删除僵尸值。
[^13]: 如果`a*b`是一个有效的赋值目标，这岂不是很疯狂？你可以想象一些类似代数的语言，试图以某种合理的方式划分所赋的值，并将其分配给`a`和`b`……这可能是一个很糟糕的主意。
[^14]: 如果 Lox 有数组和下标操作符，如`array[index]`，那么中缀操作符`[`也能允许赋值，支持：`array[index] = value`。

---

## 习题

1. 每次遇到标识符时，编译器都会将全局变量的名称作为字符串添加到常量表中。它每次都会创建一个新的常量，即使这个变量的名字已经在常量表中的前一个槽中存在。在同一个函数多次引用同一个变量的情况下，这是一种浪费。这反过来又增加了填满常量表的可能性，因为我们在一个字节码块中只允许有 256 个常量。

   对此进行优化。与运行时相比，你的优化对编译器的性能有何影响？这是正确的取舍吗？

2. 每次使用全局变量时，根据名称在哈希表中查找变量是很慢的，即使有一个很好的哈希表。你能否想出一种更有效的方法来存储和访问全局变量而不改变语义？

3. 当在 REPL 中运行时，用户可能会编写一个引用未知全局变量的函数。然后，在下一行中，他们声明了这个变量。Lox 应该优雅地处理这个问题，在第一次定义函数时不报告“未知变量”的编译错误。

   但是，当用户运行 Lox 脚本时，编译器可以在任何代码运行之前访问整个程序的全部文本。考虑一下这个程序：

   ```javascript
   fun useVar() {
     print oops;
   }

   var ooops = "too many o's!";
   ```

   这里，我们可以静态地告知用户`oops`不会被定义，因为在程序中没有任何地方对该全局变量进行了声明。请注意，`useVar()`也从未被调用，所以即使变量没有被定义，也不会发生运行时错误，因为它从未被使用。

   我们可以将这样的错误报告为编译错误，至少在运行脚本时是这样。你认为我们应该这样做吗？请说明你的答案。你知道其它脚本语言是怎么做的吗？
