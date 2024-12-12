---
title: 08. 语句和状态
description: Statements and State
---

> _终我一生，我们的内心都在渴求一种我无法名状的东西。_
>
> —— André Breton, _Mad Love_

到目前为止，我们提供解释器的感觉不太像是在使用一种真正的语言进行编程，更像是在计算器上按按钮。对我来说，"编程 "意味着用较小的部分构建出一个系统。我们目前还不支持这样做，因为我们还无法将一个名称绑定到某个数据或函数。我们不能在无法引用小片段的情况下编写软件。

为了支持绑定，我们的解释器需要保存内部状态。如果你在程序开始处定义了一个变量，并在结束处使用它，那么解释器必须在这期间保持该变量的值。所以在这一章中，我们会给解释器一个大脑，它不仅可以运算，而且可以*记忆*。

![A brain, presumably remembering stuff.](./brain.png)

状态和语句是相辅相成的。因为根据定义，语句不会计算出一个具体值，而是需要做一些事情来发挥作用。这些事情被称为**副作用(side effect)**。它可能意味着产生用户可见的输出，或者修改解释器中的一些状态，而这些状态后续可以被检测到。第二个特性使得语句非常适合于定义变量或其他命名实体。

在这一章中，我们会实现所有这些。我们会定义可以产生输出和创建状态的语句，然后会添加表达式来访问和赋值给这些变量，最后，我们会引入代码块和局部作用域。这一章要讲的内容太多了，但是我们会一点一点地把它们嚼碎。

## 8.1 语句

我们首先扩展 Lox 的语法以支持语句。 语句与表达式并没有很大的不同，我们从两种最简单的类型开始：

1. **表达式语句**可以让您将表达式放在需要语句的位置。它们的存在是为了计算有副作用的表达式。您可能没有注意到它们，但其实你在 C、Java 和其他语言中一直在使用表达式语句[^1]。如果你看到一个函数或方法调用后面跟着一个`;`，您看到的其实就是一个表达式语句。

2. **`print`语句**会计算一个表达式，并将结果展示给用户。我承认把`print`直接放进语言中，而不是把它变成一个库函数，这很奇怪[^2]。这样做是基于本书的编排策略的让步，即我们会以章节为单位逐步构建这个解释器，并希望能够在完成解释器的所有功能之前能够使用它。如果让`print`成为一个标准库函数，我们必须等到拥有了定义和调用函数的所有机制之后，才能看到它发挥作用。

新的词法意味着新的语法规则。在本章中，我们终于获得了解析整个 Lox 脚本的能力。由于 Lox 是一种命令式的、动态类型的语言，所以脚本的“顶层”也只是一组语句。新的规则如下：

```javascript
program        → statement* EOF ;

statement      → exprStmt
               | printStmt ;

exprStmt       → expression ";" ;
printStmt      → "print" expression ";" ;
```

现在第一条规则是`program`，这也是语法的起点，代表一个完整的 Lox 脚本或 REPL 输入项。程序是一个语句列表，后面跟着特殊的“文件结束”(EOF)标记。强制性的结束标记可以确保解析器能够消费所有输入内容，而不会默默地忽略脚本结尾处错误的、未消耗的标记。

目前，`statement`只有两种情况，分别对应于我们描述的两类语句。我们将在本章后面和接下来的章节中补充更多内容。接下来就是将这个语法转化为我们可以存储在内存中的东西——语法树。。

### 8.1.1 Statement 语法树

语法中没有地方既允许使用表达式，也允许使用语句。 操作符（如`+`）的操作数总是表达式，而不是语句。`while`循环的主体总是一个语句。

因为这两种语法是不相干的，所以我们不需要提供一个它们都继承的基类。将表达式和语句拆分为单独的类结构，可使 Java 编译器帮助我们发现一些愚蠢的错误，例如将语句传递给需要表达式的 Java 方法。

这意味着要为语句创建一个新的基类。正如我们的前辈那样，我们将使用“Stmt”这个隐秘的名字。我很有远见，在设计我们的 AST 元编程脚本时就已经预见到了这一点。这就是为什么我们把“Expr”作为参数传给了`defineAst()`。现在我们添加另一个方法调用来定义`Stmt`和它的子类。

_<u>tool/GenerateAst.java，在 main()方法中新增：</u>_

```java
      "Unary    : Token operator, Expr right"
    ));
    // 新增部分开始
    defineAst(outputDir, "Stmt", Arrays.asList(
      "Expression : Expr expression",
      "Print      : Expr expression"
    ));
    // 新增部分结束
  }
```

新节点对应的生成代码可以参考附录： [Appendix II](http://craftinginterpreters.com/appendix-ii.html): [Expression statement](http://craftinginterpreters.com/appendix-ii.html#expression-statement), [Print statement](http://craftinginterpreters.com/appendix-ii.html#print-statement).


运行 AST 生成器脚本，查看生成的`Stmt.java`文件，其中包含表达式和`print`语句所需的语法树类。不要忘记将该文件添加到 IDE 项目或 makefile 或其他文件中。

### 8.1.2 解析语句

解析器的`parse()`方法会解析并返回一个表达式，这是一个临时方案，是为了让上一章的代码能启动并运行起来。现在，我们的语法已经有了正确的起始规则，即`program`，我们可以正式编写`parse()`方法了。

_<u>lox/Parser.java， parse()方法，替换 7 行：</u>_

```java
  List<Stmt> parse() {
    List<Stmt> statements = new ArrayList<>();
    while (!isAtEnd()) {
      statements.add(statement());
    }

    return statements;
  }
```

该方法会尽可能多地解析一系列语句，直到命中输入内容的结尾为止。这是一种非常直接的将`program`规则转换为递归下降风格的方式。由于我们现在使用 ArrayList，所以我们还必须向 Java 的冗长之神做一个小小的祈祷。

_<u>lox/Parser.java，新增代码：</u>_

```java
package com.craftinginterpreters.lox;
// 新增部分开始
import java.util.ArrayList;
// 新增部分结束
import java.util.List;
```

一个程序就是一系列的语句，而我们可以通过下面的方法解析每一条语句：

_<u>lox/Parser.java，在 expression()方法后添加：</u>_

```java
  private Stmt statement() {
    if (match(PRINT)) return printStatement();

    return expressionStatement();
  }
```

这是一个简单的框架，但是稍后我们将会填充更多的语句类型。我们通过查看当前标记来确定匹配哪条语句规则。`print`标记意味着它显然是一个`print`语句。

如果下一个标记看起来不像任何已知类型的语句，我们就认为它一定是一个表达式语句。这是解析语句时典型的最终失败分支，因为我们很难通过第一个标记主动识别出一个表达式。

每种语句类型都有自己的方法。首先是`print`：

_<u>lox/Parser.java，在 statement()方法后添加：</u>_

```java
  private Stmt printStatement() {
    Expr value = expression();
    consume(SEMICOLON, "Expect ';' after value.");
    return new Stmt.Print(value);
  }
```

因为我们已经匹配并消费了`print`标记本身，所以这里不需要重复消费。我们先解析随后的表达式，消费表示语句终止的分号，并生成语法树。

如果我们没有匹配到`print`语句，那一定是一条下面的语句：

_<u>lox/Parser.java，在 printStatement()方法后添加：</u>_

```java
  private Stmt expressionStatement() {
    Expr expr = expression();
    consume(SEMICOLON, "Expect ';' after expression.");
    return new Stmt.Expression(expr);
  }
```

与前面的方法类似，我们解析一个后面带分号的表达式。我们将 Expr 封装在一个正确类型的 Stmt 中，并返回它。

### 8.1.3 执行语句

我们在前面几章一步一步地慢慢完成了解释器的前端工作。我们的解析器现在可以产生语句语法树，所以下一步，也是最后一步，就是对其进行解释。和表达式一样，我们使用的是 Visitor 模式，但是我们需要实现一个新的访问者接口`Stmt.Visitor`，因为语句有自己的基类。

我们将其添加到 Interpreter 实现的接口列表中。

_<u>lox/Interpreter.java，替换 1 行[^3]：</u>_

```java
// 替换部分开始
class Interpreter implements Expr.Visitor<Object>,
                             Stmt.Visitor<Void> {
// 替换部分结束
  void interpret(Expr expression) {
```

与表达式不同，语句不会产生值，因此 visit 方法的返回类型是`Void`，而不是`Object`。我们有两种语句类型，每种类型都需要一个 visit 方法。最简单的是表达式语句：

_<u>lox/Interpreter.java，在 evaluate()方法后添加：</u>_

```java
  @Override
  public Void visitExpressionStmt(Stmt.Expression stmt) {
    evaluate(stmt.expression);
    return null;
  }
```

我们使用现有的`evaluate()`方法计算内部表达式，并丢弃其结果值。然后我们返回`null`，因为 Java 要求为特殊的大写 Void 返回类型返回该值。很奇怪，但你能有什么办法呢？

`print`语句的 visit 方法没有太大的不同。

_<u>lox/Interpreter.java，在 visitExpressionStmt()方法后添加：</u>_

```java
  @Override
  public Void visitPrintStmt(Stmt.Print stmt) {
    Object value = evaluate(stmt.expression);
    System.out.println(stringify(value));
    return null;
  }
```

在丢弃表达式的值之前，我们使用上一章引入的`stringify()`方法将其转换为字符串，然后将其输出到 stdout。

我们的解释器现在可以处理语句了，但是我们还需要做一些工作将语句输入到解释器中。首先，修改 Interpreter 类中原有的`interpret()` 方法，让其能够接受一组语句——即一段程序。

_<u>lox/Interpreter.java，修改 interpret()方法，替换 8 行：</u>_

```java
  void interpret(List<Stmt> statements) {
    try {
      for (Stmt statement : statements) {
        execute(statement);
      }
    } catch (RuntimeError error) {
      Lox.runtimeError(error);
    }
  }
```

这段代码替换了原先处理单个表达式的旧代码。新代码依赖于下面的小辅助方法。

_<u>lox/Interpreter.java，在 evaluate()方法后添加：</u>_

```java
  private void execute(Stmt stmt) {
    stmt.accept(this);
  }
```

这类似于处理表达式的`evaluate()`方法，这是这里处理语句。因为我们要使用列表，所以我们需要在 Java 中引入一下。

<u>_lox/Interpreter.java_</u>

```java
package com.craftinginterpreters.lox;
// 新增部分开始
import java.util.List;
// 新增部分结束
class Interpreter implements Expr.Visitor<Object>,
```

Lox 主类中仍然是只解析单个表达式并将其传给解释器。我们将其修正如下：

_<u>lox/Lox.java，在 run()方法中替换一行：</u>_

```java
    Parser parser = new Parser(tokens);
    // 替换部分开始
    List<Stmt> statements = parser.parse();
    // 替换部分结束
    // Stop if there was a syntax error.
```

然后将对解释器的调用替换如下：

_<u>lox/Lox.java，在 run()方法中替换一行：</u>_

```java
    if (hadError) return;
    // 替换部分开始
    interpreter.interpret(statements);
    // 替换部分结束
  }
```

基本就是对新语法进行遍历。 OK，启动解释器并测试一下。 现在有必要在文本文件中草拟一个小的 Lox 程序来作为脚本运行。 就像是：

```java
print "one";
print true;
print 2 + 1;
```

它看起来就像一个真实的程序！ 请注意，REPL 现在也要求你输入完整的语句，而不是简单的表达式。 所以不要忘记后面的分号。

## 8.2 全局变量

现在我们已经有了语句，可以开始处理状态了。在深入探讨语法作用域的复杂性之前，我们先从最简单的变量（全局变量）开始[^4]。我们需要两个新的结构。

1. **变量声明**语句用于创建一个新变量。

   ```javascript
   var beverage = "espresso";
   ```

   该语句将创建一个新的绑定，将一个名称（这里是 `beverage`）和一个值（这里是字符串 `"espresso"`）关联起来。

2. 一旦声明完成，**变量表达式**就可以访问该绑定。当标识符“beverage”被用作一个表达式时，程序会查找与该名称绑定的值并返回。

   ```javascript
   print beverage; // "espresso".
   ```

稍后，我们会添加赋值和块作用域，但是这些已经足够继续后面的学习了。

### 8.2.1 变量语法

与前面一样，我们将从语法开始，从前到后依次完成实现。变量声明是一种语句，但它们不同于其他语句，我们把 statement 语法一分为二来处理该情况。这是因为语法要限制某个位置上哪些类型的语句是被允许的。

控制流语句中的子句——比如，`if`或`while`语句体中的`then`和`else`分支——都是一个语句。但是这个语句不应该是一个声明名称的语句。下面的代码是 OK 的：

```java
if (monday) print "Ugh, already?";
```

但是下面的代码不行：

```java
if (monday) var beverage = "espresso";
```

我们也*可以*允许后者，但是会令人困惑。 `beverage`变量的作用域是什么？`if`语句结束之后它是否还继续存在？如果存在的话，在其它条件下它的值是什么？这个变量是否在其它情形下也一直存在？


这样的代码有点奇怪，所以 C、Java 及类似语言中都不允许这种写法。语句就好像有两个“优先级”。有些允许语句的地方——比如在代码块内或程序顶层[^5]——可以允许任何类型的语句，包括变量声明。而其他地方只允许那些不声明名称的、优先级更高的语句。


为了适应这种区别，我们为声明名称的语句类型添加了另一条规则：

```javascript
program        → declaration* EOF ;

declaration    → varDecl
               | statement ;

statement      → exprStmt
               | printStmt ;
```

声明语句属于新的 `declaration`规则。目前，这里只有变量，但是后面还会包含函数和类。任何允许声明的地方都允许一个非声明式的语句，所以 `declaration` 规则会下降到`statement`。显然，你可以在脚本的顶层声明一些内容，所以`program`规则需要路由到新规则。

声明一个变量的规则如下：

```javascript
varDecl        → "var" IDENTIFIER ( "=" expression )? ";" ;
```

像大多数语句一样，它以一个前置关键字开头，这里是`var`。然后是一个标识符标记，作为声明变量的名称，后面是一个可选的初始化式表达式。最后，以一个分号作为结尾。

为了访问变量，我们还需要定义一个新类型的基本表达式：

```javascript
primary        → "true" | "false" | "nil"
               | NUMBER | STRING
               | "(" expression ")"
               | IDENTIFIER ;
```

`IDENTIFIER` 子语句会匹配单个标识符标记，该标记会被理解为正在访问的变量的名称。

这些新的语法规则需要其相应的语法树。在 AST 生成器中，我们为变量声明添加一个新的语句树。

_<u>tool/GenerateAst.java，在 main()方法中添加一行，前一行需要加`,`：</u>_

```java
      "Expression : Expr expression",
      "Print      : Expr expression",
      // 新增部分开始
      "Var        : Token name, Expr initializer"
      // 新增部分结束
    ));
```

这里存储了名称标记，以便我们知道该语句声明了什么，此外还有初始化表达式（如果没有，字段就是`null`）。

然后我们添加一个表达式节点用于访问变量。

_<u>tool/GenerateAst.java，在 main()方法中添加一行，前一行需要加`,`：</u>_

```javascript
      "Literal  : Object value",
      "Unary    : Token operator, Expr right",
      // 新增部分开始
      "Variable : Token name"
      // 新增部分结束
    ));
```


这只是对变量名称标记的简单包装，就是这样。像往常一样，别忘了运行 AST 生成器脚本，这样你就能得到更新的 "Expr.java "和 "Stmt.java "文件。

### 8.2.2 解析变量


在解析变量语句之前，我们需要修改一些代码，为语法中的新规则`declaration`腾出一些空间。现在，程序的最顶层是声明语句的列表，所以解析器方法的入口需要更改：

_<u>lox/Parser.java，在 parse()方法中替换 1 行：</u>_

```java
    List<Stmt> parse() {
    List<Stmt> statements = new ArrayList<>();
    while (!isAtEnd()) {
      // 替换部分开始
      statements.add(declaration());
      // 替换部分结束
    }

    return statements;
  }
```

这里会调用下面的新方法：

_<u>lox/Parser.java，在 expression()方法后添加：</u>_

```java
  private Stmt declaration() {
    try {
      if (match(VAR)) return varDeclaration();

      return statement();
    } catch (ParseError error) {
      synchronize();
      return null;
    }
  }
```

你还记得前面的章节中，我们建立了一个进行错误恢复的框架吗？现在我们终于可以用起来了。

当我们解析块或脚本中的 一系列语句时， `declaration()` 方法会被重复调用。因此当解析器进入恐慌模式时，它就是进行同步的正确位置。该方法的整个主体都封装在一个 try 块中，以捕获解析器开始错误恢复时抛出的异常。这样可以让解析器跳转到解析下一个语句或声明的开头。

真正的解析工作发生在 try 块中。首先，它通过查找前面的`var`关键字判断是否是变量声明语句。如果不是的话，就会进入已有的`statement()`方法中，解析`print`和语句表达式。

还记得 `statement()` 会在没有其它语句匹配时会尝试解析一个表达式语句吗？而`expression()`如果无法在当前语法标记处解析表达式，则会抛出一个语法错误？这一系列调用链可以保证在解析无效的声明或语句时会报告错误。

当解析器匹配到一个`var`标记时，它会跳转到：

_<u>lox/Parser.java，在 printStatement()方法后添加：</u>_

```java
  private Stmt varDeclaration() {
    Token name = consume(IDENTIFIER, "Expect variable name.");

    Expr initializer = null;
    if (match(EQUAL)) {
      initializer = expression();
    }

    consume(SEMICOLON, "Expect ';' after variable declaration.");
    return new Stmt.Var(name, initializer);
  }
```

与之前一样，递归下降代码会遵循语法规则。解析器已经匹配了`var`标记，所以接下来要消费一个标识符标记作为变量的名称。

然后，如果找到`=`标记，解析器就知道后面有一个初始化表达式，并对其进行解析。否则，它会将初始器保持为`null`。最后，会消费语句末尾所需的分号。然后将所有这些都封装到一个 Stmt.Var 语法树节点中。

解析变量表达式甚至更简单。在`primary()`中，我们需要查找一个标识符标记。

_<u>lox/Parser.java，在 primary()方法中添加：</u>_

```java
      return new Expr.Literal(previous().literal);
    }
    // 新增部分开始
    if (match(IDENTIFIER)) {
      return new Expr.Variable(previous());
    }
    // 新增部分结束
    if (match(LEFT_PAREN)) {
```

这为我们提供了声明和使用变量的可用前端，剩下的就是将其接入解释器中。在此之前，我们需要讨论变量在内存中的位置。

## 8.3 环境

变量与值之间的绑定关系需要保存在某个地方。自从 Lisp 发明圆括号以来，这种数据结构就被称为**环境**。

![An environment containing two bindings.](./environment-0971366.png)

你可以把它想象成一个映射，其中键是变量名称，值就是变量的值[^6]。实际上，这也就是我们在 Java 中采用的实现方式。我们可以直接在解释器中加入该映射及其管理代码，但是因为它形成了一个很好的概念，我们可以将其提取到单独的类中。

打开新文件，添加以下代码：

_<u>lox/Environment.java，创建新文件</u>_

```java
package com.craftinginterpreters.lox;

import java.util.HashMap;
import java.util.Map;

class Environment {
  private final Map<String, Object> values = new HashMap<>();
}
```

其中使用一个 Java Map 来保存绑定关系。这里使用原生字符串作为键，而不是使用标记。一个标记表示源文本中特定位置的一个代码单元，但是在查找变量时，具有相同名称的标识符标记都应该指向相同的变量（暂时忽略作用域）。使用原生字符串可以保证所有这些标记都会指向相同的映射键。

我们需要支持两个操作。首先，是变量定义操作，可以将一个新的名称与一个值进行绑定。

_<u>lox/Environment.java，在 Environment 类中添加：</u>_

```java
  void define(String name, Object value) {
    values.put(name, value);
  }
```

不算困难，但是我们这里也做出了一个有趣的语义抉择。当我们向映射中添加键时，没有检查该键是否已存在。这意味着下面的代码是有效的：

```javascript
var a = "before";
print a; // "before".
var a = "after";
print a; // "after".
```

变量语句不仅可以定义一个新变量，也可以用于重新定义一个已有的变量。我们可以选择将其作为一个错误来处理。用户可能不打算重新定义已有的变量（如果他们想这样做，可能会使用赋值，而不是`var`），将重定义作为错误可以帮助用户发现这个问题。

然而，这样做与 REPL 的交互很差。在与 REPL 的交互中，最好是让用户不必在脑子记录已经定义了哪些变量。我们可以在 REPL 中允许重定义，在脚本中不允许。但是这样一来，用户就不得不学习两套规则，而且一种形式的代码复制粘贴到另一种形式后可能无法运行[^7]。

所以，为了保证两种模式的统一，我们选择允许重定义——至少对于全局变量如此。一旦一个变量存在，我们就需要可以查找该变量的方法。

_<u>lox/Environment.java，在 Environment 类中添加：</u>_

```java
class Environment {
  private final Map<String, Object> values = new HashMap<>();
  // 新增部分开始
  Object get(Token name) {
    if (values.containsKey(name.lexeme)) {
      return values.get(name.lexeme);
    }

    throw new RuntimeError(name,
        "Undefined variable '" + name.lexeme + "'.");
  }
  // 新增部分结束
  void define(String name, Object value) {
```

这在语义上更有趣一些。如果找到了这个变量，只需要返回与之绑定的值。但如果没有找到呢？我们又需要做一个选择：

- 抛出语法错误

- 抛出运行时错误

- 允许该操作并返回默认值（如`nil`）

Lox 是很宽松的，但最后一个选项对我来说有点过于宽松了。把它作为语法错误（一个编译时的错误）似乎是一个明智的选择。使用未定义的变量确实是一个错误，用户越早发现这个错误就越好。

问题在于，*使用*一个变量并不等同于*引用*它。如果代码块封装在函数中，则可以在代码块中引用变量，而不必立即对其求值。如果我们把引用未声明的变量当作一个静态错误，那么定义递归函数就变得更加困难了。

通过在检查函数体之前先声明函数名称，我们可以支持单一递归——调用自身的函数。但是，这无法处理互相调用的递归程序[^8]。考虑以下代码：

```java
fun isOdd(n) {
  if (n == 0) return false;
  return isEven(n - 1);
}

fun isEven(n) {
  if (n == 0) return true;
  return isOdd(n - 1);
}
```

当我们查看`isOdd()`方法时， `isEven()` 方法被调用的时候还没有被声明。如果我们交换着两个函数的顺序，那么在查看`isEven()`方法体时会发现`isOdd()`方法未被定义[^9]。


因为将其当作*静态*错误会使递归声明过于困难，因此我们把这个错误推迟到运行时。在一个变量被定义之前引用它是可以的，只要你不对引用进行*求值*。这样可以让前面的奇偶数代码正常工作。但是执行以下代码时，你会得到一个运行时错误：

```javascript
print a;
var a = "too late!";
```

与表达式计算代码中的类型错误一样，我们通过抛出一个异常来报告运行时错误。异常中包含变量的标记，以便我们告诉用户代码的什么位置出现了错误。

### 8.3.1 解释全局变量

Interpreter 类会获取 Environment 类的一个实例。

_<u>lox/Interpreter.java，在 Interpreter 类中添加：</u>_

```java
class Interpreter implements Expr.Visitor<Object>,
                             Stmt.Visitor<Void> {
  // 添加部分开始
  private Environment environment = new Environment();
  // 添加部分结束
  void interpret(List<Stmt> statements) {
```


我们直接将它作为一个字段存储在解释器中，这样，只要解释器仍在运行，变量就会留在内存中。


我们有两个新的语法树，所以这就是两个新的访问方法。第一个是关于声明语句的。

_<u>lox/Interpreter.java，在 visitPrintStmt()方法后添加：</u>_

```java
  @Override
  public Void visitVarStmt(Stmt.Var stmt) {
    Object value = null;
    if (stmt.initializer != null) {
      value = evaluate(stmt.initializer);
    }

    environment.define(stmt.name.lexeme, value);
    return null;
  }
```

如果该变量有初始化式，我们就对其求值。如果没有，我们就需要做一个选择。我们可以通过在解析器中*要求*初始化式令其成为一个语法错误。但是，大多数语言都不会这么做，所以在 Lox 中这样做感觉有点苛刻。

我们可以使其成为运行时错误。我们允许您定义一个未初始化的变量，但如果您在对其赋值之前访问它，就会发生运行时错误。这不是一个坏主意，但是大多数动态类型的语言都不会这样做。相反，我们使用最简单的方式。或者说，如果变量没有被显式初始化，Lox 会将变量设置为`nil`。

```javascript
var a;
print a; // "nil".
```

因此，如果没有初始化式，我们将值设为`null`，这也是 Lox 中的`nil`值的 Java 表示形式。然后，我们告诉环境上下文将变量与该值进行绑定。

接下来，我们要对变量表达式求值。

_<u>lox/Interpreter.java，在 visitUnaryExpr()方法后添加：</u>_

```java
  @Override
  public Object visitVariableExpr(Expr.Variable expr) {
    return environment.get(expr.name);
  }
```

这里只是简单地将操作转发到环境上下文中，环境做了一些繁重的工作保证变量已被定义。这样，我们就可以支持基本的变量操作了。尝试以下代码：

```javascript
var a = 1;
var b = 2;
print a + b;
```

我们还不能复用代码，但是我们可以构建能够复用数据的程序。

## 8.4 赋值

你可以创建一种语言，其中有变量，但是不支持对该变量重新赋值（或更改）。Haskell 就是一个例子。SML 只支持可变引用和数组——变量不能被重新赋值。Rust 则通过要求`mut`标识符开启赋值，从而引导用户远离可更改变量。

更改变量是一种副作用，顾名思义，一些语言专家认为副作用是肮脏或不优雅的。代码应该是纯粹的数学，它会产生值——纯净的、不变的值——就像上帝造物一样。而不是一些肮脏的自动机器，将数据块转换成各种形式，一次执行一条命令。


Lox 没有这么严苛。Lox 是一个命令式语言，可变性是与生俱来的，添加对赋值操作的支持并不需要太多工作。全局变量已经支持了重定义，所以该机制的大部分功能已经存在。主要的是，我们缺少显式的赋值符号。

### 8.4.1 赋值语法

这个小小的`=`语法比看起来要更复杂。像大多数 C 派生语言一样，赋值是一个表达式，而不是一个语句。和 C 语言中一样，它是优先级最低的表达式形式。这意味着该规则在语法中处于 `expression` 和`equality`（下一个优先级的表达式）之间。

```javascript
expression     → assignment ;
assignment     → IDENTIFIER "=" assignment
               | equality ;
```

这就是说，一个`assignment`（赋值式）要么是一个标识符，后跟一个`=`和一个对应值的表达式；要么是一个等式（也就是任何其它）表达式。稍后，当我们在对象中添加属性设置式时，赋值将会变得更加复杂，比如：

```java
instance.field = "value";
```

最简单的部分就是添加新的语法树节点。

_<u>tool/GenerateAst.java，在 main()方法中添加：</u>_

```java
    defineAst(outputDir, "Expr", Arrays.asList(
      // 新增部分开始
      "Assign   : Token name, Expr value",
      // 新增部分结束
      "Binary   : Expr left, Token operator, Expr right",
```

其中包含被赋值变量的标记，一个计算新值的表达式。运行 AstGenerator 得到新的`Expr.Assign`类之后，替换掉解析器中现有的`expression()`方法的方法体，以匹配最新的规则。

_<u>lox/Parser.java，在 expression()方法中替换一行：</u>_

```java
  private Expr expression() {
    // 替换部分开始
    return assignment();
    // 替换部分结束
  }
```

这里开始变得棘手。单个标记前瞻递归下降解析器直到解析完左侧标记并且遇到`=`标记*之后*，才能判断出来正在解析的是赋值语句。你可能会想，为什么需要这样做？毕竟，我们也是完成左操作数的解析之后才知道正在解析的是`+`表达式。

区别在于，赋值表达式的左侧不是可以求值的表达式，而是一种伪表达式，计算出的是一个你可以赋值的“东西”。考虑以下代码：

```javascript
var a = "before";
a = "value";
```

在第二行中，我们不会对`a`进行求值（如果求值会返回“before”）。我们要弄清楚`a`指向的是什么变量，这样我们就知道该在哪里保存右侧表达式的值。这两个概念的[经典术语](<https://en.wikipedia.org/wiki/Value_(computer_science)#lrvalue>)是**左值**和**右值**。到目前为止，我们看到的所有产生值的表达式都是右值。左值"计算"会得到一个存储位置，你可以向其赋值。

我们希望语法树能够反映出左值不会像常规表达式那样计算。这也是为什么 Expr.Assign 节点的左侧是一个 Token，而不是 Expr。问题在于，解析器直到遇到`=`才知道正在解析一个左值。在一个复杂的左值中，可能在出现很多标记之后才能识别到。

```java
makeList().head.next = node;
```

我们只会前瞻一个标记，那我们该怎么办呢？我们使用一个小技巧，看起来像下面这样[^10]：

_<u>lox/Parser.java，在 expressionStatement()方法后添加：</u>_

```java
  private Expr assignment() {
    Expr expr = equality();

    if (match(EQUAL)) {
      Token equals = previous();
      Expr value = assignment();

      if (expr instanceof Expr.Variable) {
        Token name = ((Expr.Variable)expr).name;
        return new Expr.Assign(name, value);
      }

      error(equals, "Invalid assignment target.");
    }

    return expr;
  }
```

解析赋值表达式的大部分代码看起来与解析其它二元运算符（如`+`）的代码类似。我们解析左边的内容，它可以是任何优先级更高的表达式。如果我们发现一个`=`，就解析右侧内容，并把它们封装到一个复杂表达式树节点中。


与二元运算符的一个细微差别在于，我们不会循环构建相同操作符的序列。因为赋值操作是右关联的，所以我们递归调用 `assignment()`来解析右侧的值。


诀窍在于，在创建赋值表达式节点之前，我们先查看左边的表达式，弄清楚它是什么类型的赋值目标。然后我们将右值表达式节点转换为左值的表示形式。

这种转换是有效的，因为事实证明，每个有效的赋值目标正好也是符合普通表达式的有效语法[^11]。考虑一个复杂的属性赋值操作，如下：

```java
newPoint(x + 2, 0).y = 3;
```

该赋值表达式的左侧也是一个有效的表达式。

```java
newPoint(x + 2, 0).y;
```

第一个例子设置该字段，第二个例子获取该字段。
这意味着，我们可以像解析表达式一样解析左侧内容，然后生成一个语法树，将其转换为赋值目标。如果左边的表达式不是一个有效的赋值目标，就会出现一个语法错误[^12]。这样可以确保在遇到类似下面的代码时会报告错误：

```java
a + b = c;
```

现在，唯一有效的赋值目标就是一个简单的变量表达式，但是我们后面会添加属性字段。这个技巧的最终结果是一个赋值表达式树节点，该节点知道要向什么赋值，并且有一个表达式子树用于计算要使用的值。所有这些都只用了一个前瞻标记，并且没有回溯。

### 8.4.2 赋值语义

我们有了一个新的语法树节点，所以我们的解释器也需要一个新的访问方法。

_<u>lox/Interpreter.java，在 visitVarStmt()方法后添加：</u>_

```java
  @Override
  public Object visitAssignExpr(Expr.Assign expr) {
    Object value = evaluate(expr.value);
    environment.assign(expr.name, value);
    return value;
  }
```

很明显，这与变量声明很类似。首先，对右侧表达式运算以获取值，然后将其保存到命名变量中。这里不使用 Environment 中的 `define()`，而是调用下面的新方法：

_<u>lox/Environment.java，在 get()方法后添加：</u>_

```java
  void assign(Token name, Object value) {
    if (values.containsKey(name.lexeme)) {
      values.put(name.lexeme, value);
      return;
    }

    throw new RuntimeError(name,
        "Undefined variable '" + name.lexeme + "'.");
  }
```

赋值与定义的主要区别在于，赋值操作不允许创建新变量。就我们的实现而言，这意味着如果环境的变量映射中不存在变量的键，那就是一个运行时错误[^13]。

`visit()`方法做的最后一件事就是返回要赋给变量的值。这是因为赋值是一个表达式，可以嵌套在其他表达式里面，就像这样:

```javascript
var a = 1;
print a = 2; // "2".
```

我们的解释器现在可以创建、读取和修改变量。这和早期的 BASICS 一样复杂。全局变量很简单，但是在编写一个大型程序时，任何两块代码都可能不小心修改对方的状态，这就不好玩了。我们需要*局部*变量，这意味着是时候讨论*作用域*了。

## 8.5 作用域

**作用域**定义了名称映射到特定实体的一个区域。多个作用域允许同一个名称在不同的上下文中指向不同的内容。在我家，“Bob”通常指的是我自己，但是在你的身边，你可能认识另外一个 Bob。同一个名字，基于你的所知所见指向了不同的人。


**词法作用域**（或者比较少见的**静态作用域**）是一种特殊的作用域定义方式，程序本身的文本显示了作用域的开始和结束位置[^14]。Lox，和大多数现代语言一样，变量在词法作用域内有效。当你看到使用了某些变量的表达式时，你通过静态地阅读代码就可以确定其指向的变量声明。

举例来说：

```javascript
{
  var a = "first";
  print a; // "first".
}

{
  var a = "second";
  print a; // "second".
}
```

这里，我们在两个块中都定义了一个变量`a`。我们可以从代码中看出，在第一个`print`语句中使用的`a`指的是第一个`a`，第二个语句指向的是第二个变量。

![An environment for each 'a'.](./blocks.png)

这与**动态作用域**形成了对比，在动态作用域中，直到执行代码时才知道名称指向的是什么。Lox 没有动态作用域*变量*，但是对象上的方法和字段是动态作用域的。

```java
class Saxophone {
  play() {
    print "Careless Whisper";
  }
}

class GolfClub {
  play() {
    print "Fore!";
  }
}

fun playIt(thing) {
  thing.play();
}
```

当`playIt()`调用`thing.play()`时，我们不知道我们将要听到的是 "Careless Whisper "还是 "Fore!" 。这取决于你向函数传递的是 Saxophone 还是 GolfClub，而我们在运行时才知道这一点。


作用域和环境是近亲，前者是理论概念，而后者是实现它的机制。当我们的解释器处理代码时，影响作用域的语法树节点会改变环境上下文。在像 Lox 这样的类 C 语言语法中，作用域是由花括号的块控制的。（这就是为什么我们称它为**块范围**）。

```java
{
  var a = "in block";
}
print a; // Error! No more "a".
```

块的开始引入了一个新的局部作用域，当执行通过结束的`}`时，这个作用域就结束了。块内声明的任何变量都会消失。

### 8.5.1 嵌套和遮蔽

实现块作用域的第一步可能是这样的：

1. 当访问块内的每个语句时，跟踪所有声明的变量。

2. 执行完最后一条语句后，告诉环境将这些变量全部删除。

这对前面的例子是可行的。但是请记住，局部作用域的一个目的是封装——程序中一个块内的代码，不应该干扰其他代码块。看看下面的例子：

```java
// How loud?
var volume = 11;

// Silence.
volume = 0;

// Calculate size of 3x4x5 cuboid.
{
  var volume = 3 * 4 * 5;
  print volume;
}
```


请看这个代码块，在这里我们声明了一个局部变量`volume`来计算长方体的体积。该代码块退出后，解释器将删除*全局*`volume`变量。这是不对的。当我们退出代码块时，我们应该删除在块内声明的所有变量，但是如果在代码块外声明了相同名称的变量，那就是一个不同的变量。它不应该被删除。

当局部变量与外围作用域中的变量具有相同的名称时，内部变量会遮蔽外部变量。代码块内部不能再看到外部变量——它被遮蔽在内部变量的阴影中——但它仍然是存在的。


当进入一个新的块作用域时，我们需要保留在外部作用域中定义的变量，这样当我们退出内部代码块时这些外部变量仍然存在。为此，我们为每个代码块定义一个新的环境，该环境只包含该作用域中定义的变量。当我们退出代码块时，我们将丢弃其环境并恢复前一个环境。

我们还需要处理没有被遮蔽的外围变量。

```javascript
var global = "outside";
{
  var local = "inside";
  print global + local;
}
```


这段代码中，`global`在外部全局环境中，`local`则在块环境中定义。在执行 print`语句时，这两个变量都在作用域内。为了找到它们，解释器不仅要搜索当前最内层的环境，还必须搜索所有外围的环境。

我们通过将环境链接在一起来实现这一点。每个环境都有一个对直接外围作用域的环境的引用。当我们查找一个变量时，我们从最内层开始遍历环境链直到找到该变量。从内部作用域开始，就是我们使局部变量遮蔽外部变量的方式。

![Environments for each scope, linked together.](./chaining.png)

在我们添加块语法之前，我们要强化 Environment 类对这种嵌套的支持。首先，我们在每个环境中添加一个对其外围环境的引用。

_<u>lox/Environment.java，在 Environment 类中添加：</u>_

```java
class Environment {
  // 新增部分开始
  final Environment enclosing;
  // 新增部分结束
  private final Map<String, Object> values = new HashMap<>();
```

这个字段需要初始化，所以我们添加两个构造函数。

_<u>lox/Environment.java，在 Environment 类中添加：</u>_

```java
  Environment() {
    enclosing = null;
  }

  Environment(Environment enclosing) {
    this.enclosing = enclosing;
  }
```


无参构造函数用于全局作用域环境，它是环境链的结束点。另一个构造函数用来创建一个嵌套在给定外部作用域内的新的局部作用域。

我们不必修改`define()`方法——因为新变量总是在当前最内层的作用域中声明。但是变量的查找和赋值是结合已有的变量一起处理的，需要遍历环境链以找到它们。首先是查找操作：

_<u>lox/Environment.java，在 get()方法中添加：</u>_

```java
      return values.get(name.lexeme);
    }
    // 新增部分开始
    if (enclosing != null) return enclosing.get(name);
    // 新增部分结束
    throw new RuntimeError(name,
        "Undefined variable '" + name.lexeme + "'.");
```

如果当前环境中没有找到变量，就在外围环境中尝试。然后递归地重复该操作，最终会遍历完整个链路。如果我们到达了一个没有外围环境的环境，并且仍然没有找到这个变量，那我们就放弃，并且像之前一样报告一个错误。

赋值也是如此。

_<u>lox/Environment.java，在 assign()方法中添加：</u>_

```java
      values.put(name.lexeme, value);
      return;
    }
    // 新增部分开始
    if (enclosing != null) {
      enclosing.assign(name, value);
      return;
    }
    // 新增部分结束
    throw new RuntimeError(name,
```


同样，如果变量不在此环境中，它会递归地检查外围环境。

### 8.5.2 块语法和语义


现在环境已经嵌套了，我们就准备向语言中添加块了。请看以下语法：

```javascript
statement      → exprStmt
               | printStmt
               | block ;

block          → "{" declaration* "}" ;
```

块是由花括号包围的一系列语句或声明(可能是空的)。块本身就是一条语句，可以出现在任何允许语句的地方。语法树节点如下所示。

_<u>tool/GenerateAst.java，在 main()方法中添加：</u>_

```java
    defineAst(outputDir, "Stmt", Arrays.asList(
      // 新增部分开始
      "Block      : List<Stmt> statements",
      // 新增部分结束
      "Expression : Expr expression",
```

它包含块中语句的列表。解析很简单。与其他语句一样，我们通过块的前缀标记(在本例中是`{`)来检测块的开始。在`statement()`方法中，我们添加代码：

_<u>lox/Parser.java，在 statement()方法中添加：</u>_

```java
    if (match(PRINT)) return printStatement();
    // 新增部分开始
    if (match(LEFT_BRACE)) return new Stmt.Block(block());
    // 新增部分结束
    return expressionStatement();
```


真正的工作都在这里进行：

_<u>lox/Parser.java，在 expressionStatement()方法后添加：</u>_

```java
  private List<Stmt> block() {
    List<Stmt> statements = new ArrayList<>();

    while (!check(RIGHT_BRACE) && !isAtEnd()) {
      statements.add(declaration());
    }

    consume(RIGHT_BRACE, "Expect '}' after block.");
    return statements;
  }
```

我们先创建一个空列表，然后解析语句并将其放入列表中，直至遇到块的结尾（由`}`符号标识）[^15]。注意，该循环还有一个明确的`isAtEnd()`检查。我们必须小心避免无限循环，即使在解析无效代码时也是如此。如果用户忘记了结尾的`}`，解析器需要保证不能被阻塞。

语法到此为止。对于语义，我们要在 Interpreter 中添加另一个访问方法。

_<u>lox/Interpreter.java，在 execute()方法后添加：</u>_

```java
  @Override
  public Void visitBlockStmt(Stmt.Block stmt) {
    executeBlock(stmt.statements, new Environment(environment));
    return null;
  }
```

要执行一个块，我们先为该块作用域创建一个新的环境，然后将其传入下面这个方法：

_<u>lox/Interpreter.java，在 execute()方法后添加：</u>_

```java
  void executeBlock(List<Stmt> statements,
                    Environment environment) {
    Environment previous = this.environment;
    try {
      this.environment = environment;

      for (Stmt statement : statements) {
        execute(statement);
      }
    } finally {
      this.environment = previous;
    }
  }
```

这个新方法会在给定的环境上下文中执行一系列语句。在此之前，解释器中的 `environment` 字段总是指向相同的环境——全局环境。现在，这个字段会指向*当前*环境，也就是与要执行的代码的最内层作用域相对应的环境[^16]。

为了在给定作用域内执行代码，该方法会先更新解释器的 `environment` 字段，执行所有的语句，然后恢复之前的环境。基于 Java 中一贯的优良传统，它使用`finally`子句来恢复先前的环境。这样一来，即使抛出了异常，环境也会被恢复。

出乎意料的是，这就是我们为了完全支持局部变量、嵌套和遮蔽所需要做的全部事情。试运行下面的代码：

```javascript
var a = "global a";
var b = "global b";
var c = "global c";
{
  var a = "outer a";
  var b = "outer b";
  {
    var a = "inner a";
    print a;
    print b;
    print c;
  }
  print a;
  print b;
  print c;
}
print a;
print b;
print c;
```

我们的小解释器现在可以记住东西了，我们距离全功能编程语言又近了一步。

[^1]: Pascal 是一个异类。它区分了过程和函数。函数可以返回值，但过程不能。语言中有一个语句形式用于调用过程，但函数只能在需要表达式的地方被调用。在 Pascal 中没有表达式语句。
[^2]: 我只想说，BASIC 和 Python 有专门的`print`语句，而且它们是真正的语言。当然，Python 确实在 3.0 中删除了`print`语句。
[^3]: Java 不允许使用小写的 void 作为泛型类型参数，这是因为一些与类型擦除和堆栈有关的隐晦原因。相应的，提供了一个单独的 Void 类型专门用于此用途，相当于装箱后的 void，就像 Integer 与 int 的关系。
[^4]: 全局状态的名声不好。当然，过多的全局状态（尤其是可变状态）使维护大型程序变得困难。一个出色的软件工程师会尽量减少使用全局变量。但是，如果你正在拼凑一种简单的编程语言，甚至是在学习第一种语言时，全局变量的简单性会有所帮助。我学习的第一门语言是 BASIC，虽然我最后不再使用了，但是在我能够熟练使用计算机完成有趣的工作之前，如果能够不需要考虑作用域规则，这一点很好。
[^5]: 代码块语句的形式类似于表达式中的括号。“块”本身处于“较高”的优先级，并且可以在任何地方使用，如`if`语句的子语句中。而其中*包含的*可以是优先级较低的语句。你可以在块中声明变量或其它名称。通过大括号，你可以在只允许某些语句的位置书写完整的语句语法。
[^6]: Java 中称之为**映射**或**哈希映射**。其他语言称它们为**哈希表**、**字典**(Python 和 c#)、**哈希表**(Ruby 和 Perl)、**表**(Lua)或**关联数组**(PHP)。很久以前，它们被称为**分散表**。
[^7]: 我关于变量和作用域的原则是，“如果有疑问，参考 Scheme 的做法”。Scheme 的开发人员可能比我们花了更多的时间来考虑变量范围的问题——Scheme 的主要目标之一就是向世界介绍词法作用域，所以如果你跟随他们的脚步，就很难出错。Scheme 允许在顶层重新定义变量。
[^8]: 当然，这可能不是判断一个数字是奇偶性的最有效方法（更不用说如果传入一个非整数或负数，程序会发生不可控的事情）。忍耐一下吧。
[^9]: 一些静态类型的语言，如 Java 和 C#，通过规定程序的顶层不是一连串的命令式语句来解决这个问题。相应的，它们认为程序是一组同时出现的声明。语言实现在查看任何函数的主体之前，会先声明所有的名字。<br/>像 C 和 Pascal 这样的老式语言并不是这样工作的。相反，它们会强制用户添加明确的前向声明，从而在名称完全定义之前先声明它。这是对当时有限的计算能力的一种让步。它们希望能够通过一次文本遍历就编译完一个源文件，因此这些编译器不能在处理函数体之前先收集所有声明。
[^10]: 如果左侧不是有效的赋值目标，我们会报告一个错误，但我们不会抛出该错误，因为解析器并没有处于需要进入恐慌模式和同步的混乱状态。
[^11]: 即使存在不是有效表达式的赋值目标，你也可以使用这个技巧。定义一个**覆盖语法**，一个可以接受所有有效表达式和赋值目标的宽松语法。如果你遇到了`=`，并且左侧不是有效的赋值目标则报告错误。相对地，如果没有遇到`=`，而且左侧不是有效的表达式也报告一个错误。
[^12]: 早在解析一章，我就说过我们要在语法树中表示圆括号表达式，因为我们以后会用到。这就是为什么。我们需要能够区分这些情况：

```java
a = 3;   // OK.
(a) = 3; // Error.
```

[^13]: 与 Python 和 Ruby 不同，Lox 不做[隐式变量声明](http://craftinginterpreters.com/statements-and-state.html#design-note)。
[^14]: “词法”来自希腊语“ lexikos”，意思是“与单词有关”。 当我们在编程语言中使用它时，通常意味着您无需执行任何操作即可从源代码本身中获取到一些东西。词法作用域是随着 ALGOL 出现的。早期的语言通常是动态作用域的。当时的计算机科学家认为，动态作用域的执行速度更快。今天，多亏了早期的 Scheme 研究者，我们知道这不是真的。甚至可以说，情况恰恰相反。变量的动态作用域仍然存在于某些角落。Emacs Lisp 默认为变量的动态作用域。Clojure 中的[`binding`](http://clojuredocs.org/clojure.core/binding)宏也提供了。JavaScript 中普遍不被喜欢的[`with`语句](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/with)将对象上的属性转换为动态作用域变量。
[^15]: 让`block()`返回原始的语句列表，并在`statement()`方法中将该列表封装在 Stmt.Block 中，这看起来有点奇怪。我这样做是因为稍后我们会重用`block()`来解析函数体，我们当然不希望函数体被封装在 Stmt.Block 中。
[^16]: 手动修改和恢复一个可变的`environment`字段感觉很不优雅。另一种经典方法是显式地将环境作为参数传递给每个访问方法。如果要“改变”环境，就在沿树向下递归时传入一个不同的环境。你不必恢复旧的环境，因为新的环境存在于 Java 堆栈中，当解释器从块的访问方法返回时，该环境会被隐式丢弃。我曾考虑过在 jlox 中这样做，但在每一个访问方法中加入一个环境参数，这有点繁琐和冗长。为了让这本书更简单，我选择了可变字段。

---

## 习题

> 1、The REPL no longer supports entering a single expression and automatically printing its result value. That’s a drag. Add support to the REPL to let users type in both statements and expressions. If they enter a statement, execute it. If they enter an expression, evaluate it and display the result value.

1、REPL 不再支持输入一个表达式并自动打印其结果值。这是个累赘。在 REPL 中增加支持，让用户既可以输入语句又可以输入表达式。如果他们输入一个语句，就执行它。如果他们输入一个表达式，则对表达式求值并显示结果值。

> 2、Maybe you want Lox to be a little more explicit about variable initialization. Instead of implicitly initializing variables to `nil`, make it a runtime error to access a variable that has not been initialized or assigned to, as in:

2、也许你希望 Lox 对变量的初始化更明确一些。与其隐式地将变量初始化为 nil，不如将访问一个未被初始化或赋值的变量作为一个运行时错误，如：

```javascript
// No initializers.
var a;
var b;

a = "assigned";
print a; // OK, was assigned first.

print b; // Error!
```

> 3、What does the following program do?

3、下面的代码会怎么执行？

```javascript
var a = 1;
{
  var a = a + 2;
  print a;
}
```

你期望它怎么执行？它是按照你的想法执行的吗？你所熟悉的其他语言中的类似代码怎么执行？你认为用户会期望它怎么执行？

---

## 设计笔记：隐式变量声明

Lox 使用不同的语法来声明新变量和为已有变量赋值。有些语言将其简化为只有赋值语法。对一个不存在的变量进行赋值时会自动生成该变量。这被称为**隐式变量声明**，存在于 Python、Ruby 和 CoffeeScript 以及其他语言中。JavaScript 有一个显式的语法来声明变量，但是也可以在赋值时创建新变量。Visual Basic 有一个[选项可以启用或禁用隐式变量](<https://msdn.microsoft.com/en-us/library/xe53dz5w(v=vs.100).aspx>)。

当同样的语法既可以对变量赋值，也可以创建变量时，语言实现就必须决定在不清楚用户的预期行为时该怎么办。特别是，每种语言必须选择隐式变量声明与变量遮蔽的交互方式，以及隐式变量应该属于哪个作用域。

- 在 Python 中，赋值总是会在当前函数的作用域内创建一个变量，即使在函数外部声明了同名变量。
- Ruby 通过对局部变量和全局变量使用不同的命名规则，避免了一些歧义。 但是，Ruby 中的块（更像闭包，而不是 C 中的“块”）具有自己的作用域，因此仍然存在问题。在 Ruby 中，如果已经存在一个同名的变量，则赋值会赋给当前块之外的现有变量。否则，就会在当前块的作用域中创建一个新变量。
- CoffeeScript 在许多方面都效仿 Ruby，这一点也类似。它明确禁止变量遮蔽，要求赋值时总是优先赋给外部作用域中现有的变量（一直到最外层的全局作用域）。如果变量不存在的话，它会在当前函数作用域中创建新变量。
- 在 JavaScript 中，赋值会修改任意外部作用域中的一个现有变量（如果能找到该变量的话）。如果变量不存在，它就隐式地在全局作用域内创建一个新的变量。

隐式声明的主要优点是简单。语法较少，无需学习“声明”概念。用户可以直接开始赋值，然后语言就能解决其它问题。

像 C 这样较早的静态类型语言受益于显式声明，是因为它们给用户提供了一个地方，让他们告诉编译器每个变量的类型以及为它分配多少存储空间。在动态类型、垃圾收集的语言中，这其实是没有必要的，所以你可以通过隐式声明来实现。这感觉更 "脚本化"，更像是 "你懂我的意思吧"。

但这是就个好主意吗？隐式声明还存在一些问题。

- 用户可能打算为现有变量赋值，但是出现拼写错误。解释器不知道这一点，所以它悄悄地创建了一些新变量，而用户想要赋值的变量仍然是原来的值。这在 JavaScript 中尤其令人讨厌，因为一个拼写错误会创建一个全局变量，这反过来又可能会干扰其它代码。
- JS、Ruby 和 CoffeeScript 通过判断是否存在同名变量——包括外部作用域——来确定赋值是创建新变量还是赋值给现有变量。这意味着在外围作用域中添加一个新变量可能会改变现有代码的含义，原先的局部变量可能会默默地变成对新的外部变量的赋值。
- 在 Python 中，你可能想要赋值给当前函数之外的某个变量，而不是在当前函数中创建一个新变量，但是你做不到。

随着时间的推移，我所知道的具有隐式变量声明的语言最后都增加了更多的功能和复杂性来处理这些问题。

- 现在，普遍认为 JavaScript 中全局变量的隐式声明是一个错误。“Strict mode ”禁用了它，并将其成为一个编译错误。
- Python 添加了一个`global`语句，让用户可以在函数内部显式地赋值给一个全局变量。后来，随着函数式编程和嵌套函数越来越流行，他们添加了一个类似的`nonlocal`语句来赋值给外围函数中的变量。
- Ruby 扩展了它的块语法，允许在块中显式地声明某些变量，即使外部作用域中存在同名的变量。

考虑到这些，我认为简单性的论点已经失去了意义。有一种观点认为隐式声明是正确的默认选项，但我个人认为这种说法不太有说服力。

我的观点是，隐式声明在过去的几年里是有意义的，当时大多数脚本语言都是非常命令式的，代码是相当简单直观的。随着程序员对深度嵌套、函数式编程和闭包越来越熟悉，访问外部作用域中的变量变得越来越普遍。这使得用户更有可能遇到棘手的情况，即不清楚他们的赋值是要创建一个新变量还是重用外围的已有变量。

所以我更喜欢显式声明变量，这就是 Lox 要这样做的原因。
