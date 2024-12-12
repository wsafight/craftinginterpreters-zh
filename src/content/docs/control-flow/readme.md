---
title: 09. 控制流
description: Control Flow
---

> 逻辑和威士忌一样，如果摄入太多，就会失去其有益的效果。
>
> ​ —— Edward John Moreton Drax Plunkett, Lord Dunsany

与上一章艰苦的马拉松相比，这一章就是在雏菊草地上的轻松嬉戏。虽然工作很简单，但回报却惊人的大。

现在，我们的解释器只不过是一个计算器而已。一个 Lox 程序在结束之前只能做固定的工作量。要想让它的运行时间延长一倍，你就必须让源代码的长度增加一倍。我们即将解决这个问题。在本章中，我们的解释器向编程语言大联盟迈出了一大步：图灵完备性。

## 9.1 图灵机（简介）

在上世纪初，数学家们陷入了一系列令人困惑的悖论之中，导致他们对自己工作所依赖的基础的稳定性产生怀疑[^1]。为了解决这一[危机](https://en.wikipedia.org/wiki/Foundations_of_mathematics#Foundational_crisis)，他们又回到了原点。他们希望从少量的公理、逻辑和集合理论开始，在一个不透水的地基上重建数学。

他们想要严格地回答这样的问题：“所有真实的陈述都可以被证明吗？”，“我们可以计算我们能定义的所有函数吗？”，甚至是更一般性的问题，“当我们声称一个函数是'可计算的'时，代表什么意思？”

他们认为前两个问题的答案应该是“是”，剩下的就是去证明它。但事实证明这两个问题的答案都是“否”。而且令人惊讶的是，这两个问题是深深地交织在一起的。这是数学的一个迷人的角落，它触及了关于大脑能够做什么和宇宙如何运作的基本问题。我在这里说不清楚。

我想指出的是，在证明前两个问题的答案是 "否 "的过程中，艾伦·图灵和阿隆佐·邱奇为最后一个问题设计了一个精确的答案，即定义了什么样的函数是可计算的。他们各自设计了一个具有最小机械集的微型系统，该系统仍然强大到足以计算一个超大类函数中的任何一个。

这些现在被认为是“可计算函数”。图灵的系统被称为**图灵机**[^2]，邱奇的系统是**lambda 演算**。这两种方法仍然被广泛用作计算模型的基础，事实上，许多现代函数式编程语言的核心都是 lambda 演算。

![A Turing machine.](./turing-machine.png)

图灵机的知名度更高——目前还没有关于阿隆佐·邱奇的好莱坞电影，但这两种形式[在能力上是等价的](https://en.wikipedia.org/wiki/Church%E2%80%93Turing_thesis)。事实上，任何具有最低表达能力的编程语言都足以计算任何可计算函数。

你可以用自己的语言为图灵机编写一个模拟器来证明这一点。由于图灵证明了他的机器可以计算任何可计算函数，推而广之，这意味着你的语言也可以。你所需要做的就是把函数翻译成图灵机，然后在你的模拟器上运行它。

如果你的语言有足够的表达能力来做到这一点，它就被认为是**图灵完备**的。图灵机非常简单，所以它不需要太多的能力。您基本上只需要算术、一点控制流以及分配和使用(理论上)任意数量内存的能力。我们已经具备了第一个条件[^3]。在本章结束时，我们将具备第二个条件。

## 9.2 条件执行

说完了历史，现在让我们把语言优化一下。我们大致可以把控制流分为两类：

- **条件**或**分支控制流**是用来不执行某些代码的。意思是，你可以把它看作是跳过了代码的一个区域。

- **循环控制流**是用于多次执行一块代码的。它会*向回*跳转，从而能再次执行某些代码。用户通常不需要无限循环，所以一般也会有一些条件逻辑用于判断何时停止循环。

分支更简单一些，所以我们先从分支开始实现。C 衍生语言中包含两个主要的条件执行功能，即`if`语句和“条件”运算符（`?:`）[^4]。`if`语句使你可以按条件执行语句，而条件运算符使你可以按条件执行表达式。

为了简单起见，Lox 没有条件运算符，所以让我们直接开始`if`语句吧。我们的语句语法需要一个新的生成式。

```javascript
statement      → exprStmt
               | ifStmt
               | printStmt
               | block ;

ifStmt         → "if" "(" expression ")" statement
               ( "else" statement )? ;
```

if 语句有一个表达式作为条件，然后是一个在条件为真时要执行的语句。另外，它还可以有一个`else`关键字和条件为假时要执行的语句。语法树节点中对语法的这三部分都有对应的字段。

_<u>tool/GenerateAst.java，在 main()方法中添加：</u>_

```java
      "Expression : Expr expression",
      // 新增部分开始
      "If         : Expr condition, Stmt thenBranch," +
                  " Stmt elseBranch",
      // 新增部分结束
      "Print      : Expr expression",
```


与其它语句类似，解析器通过开头的`if`关键字来识别`if`语句。

_<u>lox/Parser.java，在 statement()方法中添加：</u>_

```java
  private Stmt statement() {
    // 新增部分开始
    if (match(IF)) return ifStatement();
    // 新增部分结束
    if (match(PRINT)) return printStatement();
```

如果发现了`if`关键字，就调用下面的新方法解析其余部分[^5]：

_<u>lox/Parser.java，在 statement()方法后添加：</u>_

```java
  private Stmt ifStatement() {
    consume(LEFT_PAREN, "Expect '(' after 'if'.");
    Expr condition = expression();
    consume(RIGHT_PAREN, "Expect ')' after if condition.");

    Stmt thenBranch = statement();
    Stmt elseBranch = null;
    if (match(ELSE)) {
      elseBranch = statement();
    }

    return new Stmt.If(condition, thenBranch, elseBranch);
  }
```

跟之前一样，解析代码严格遵循语法。它通过查找前面的`else`关键字来检测`else`子句。如果没有，语法树中的`elseBranch`字段为`null`。

实际上，这个看似无伤大雅的可选项在我们的语法中造成了歧义。考虑以下代码：

```java
if (first) if (second) whenTrue(); else whenFalse();
```

谜题是这样的:这里的`else`子句属于哪个`if`语句?这不仅仅是一个关于如何标注语法的理论问题。它实际上会影响代码的执行方式：

- 如果我们将`else`语句关联到第一个`if`语句，那么当`first`为假时，无论`second`的值是多少，都将调用`whenFalse()`。

- 如果我们将`else`语句关联到第二个`if`语句，那么只有当`first`为真并且`second`为假时，才会调用`whenFalse()`。

由于`else`子句是可选的，而且没有明确的分隔符来标记`if`语句的结尾，所以当你以这种方式嵌套`if`时，语法是不明确的。这种典型的语法陷阱被称为[悬空的 else](https://en.wikipedia.org/wiki/Dangling_else)问题。

![Two ways the else can be interpreted.](./dangling-else.png)

也可以定义一个上下文无关的语法来直接避免歧义，但是需要将大部分语句规则拆分成对，一个是允许带有`else`的`if`语句，另一个不允许。这很烦人。

相反，大多数语言和解析器都以一种特殊的方式避免了这个问题。不管他们用什么方法来解决这个问题，他们总是选择同样的解释——`else`与前面最近的`if`绑定在一起。

我们的解析器已经很方便地做到了这一点。因为 `ifStatement()`在返回之前会继续寻找一个`else`子句，连续嵌套的最内层调用在返回外部的`if`语句之前，会先为自己声明`else`语句。

语法就绪了，我们可以开始解释了。

_<u>lox/Interpreter.java，在 visitExpressionStmt()后添加：</u>_

```java
  @Override
  public Void visitIfStmt(Stmt.If stmt) {
    if (isTruthy(evaluate(stmt.condition))) {
      execute(stmt.thenBranch);
    } else if (stmt.elseBranch != null) {
      execute(stmt.elseBranch);
    }
    return null;
  }
```

解释器实现就是对相同的 Java 代码的简单包装。它首先对条件表达式进行求值。如果为真，则执行`then`分支。否则，如果有存在`else`分支，就执行该分支。


如果你把这段代码与解释器中我们已实现的处理其它语法的代码进行比较，会发现控制流中特殊的地方就在于 Java 的`if`语句。其它大多数语法树总是会对子树求值，但是这里，我们可能会不执行`then`语句或`else`语句。如果其中任何一个语句有副作用，那么选择不执行某条语句就是用户可见的。

## 9.3 逻辑操作符

由于我们没有条件运算符，你可能认为我们已经完成分支开发了，但其实还没有。虽然没有三元运算符，但是还有两个其它操作符在技术上是控制流结构——逻辑运算符`and`和`or`。


它们与其它二进制运算符不同，是因为它们会短路。如果在计算左操作数之后，我们已经确切知道逻辑表达式的结果，那么就不再计算右操作数。例如：

```java
false and sideEffect();
```


对于一个`and`表达式来说，两个操作数都必须是真，才能得到结果为真。我们只要看到左侧的`false`操作数，就知道结果不会是真，也就不需要对`sideEffect()`求值，会直接跳过它。

这就是为什么我们没有在实现其它二元运算符的时候一起实现逻辑运算符。现在我们已经准备好了。这两个新的运算符在优先级表中的位置很低，类似于 C 语言中的`||`和`&&`，它们都有各自的优先级，`or`低于`and`。我们把这两个运算符插入`assignment` 和 `equality`之间。

```javascript
expression     → assignment ;
assignment     → IDENTIFIER "=" assignment
               | logic_or ;
logic_or       → logic_and ( "or" logic_and )* ;
logic_and      → equality ( "and" equality )* ;
```

`assignment` 现在不是落到 `equality`，而是继续进入`logic_or`。两个新规则，`logic_or` 和 `logic_and`，与其它二元运算符类似。然后`logic_and`会调用`equality`计算其操作数，然后我们就链入了表达式规则的其它部分。

对于这两个新表达式，我们可以重用 Expr.Binary 类，因为他们具有相同的字段。但是这样的话，`visitBinaryExpr()` 方法中必须检查运算符是否是逻辑运算符，并且要使用不同的代码处理短路逻辑。我认为更整洁的方法是为这些运算符定义一个新类，这样它们就有了自己的`visit`方法。

_<u>tool/GenerateAst.java，在 main()方法中添加：</u>_

```java
      "Literal  : Object value",
      // 新增部分开始
      "Logical  : Expr left, Token operator, Expr right",
      // 新增部分结束
      "Unary    : Token operator, Expr right",
```


为了将新的表达式加入到解析器中，我们首先将赋值操作的解析代码改为调用`or()`方法。

_<u>lox/Parser.java,在 assignment()方法中替换一行：</u>_

```java
  private Expr assignment() {
    // 新增部分开始
    Expr expr = or();
    // 新增部分结束
    if (match(EQUAL)) {
```
解析一系列`or`语句的代码与其它二元运算符相似。

_<u>lox/Parser.java，在 assignment()方法后添加：</u>_

```java
  private Expr or() {
    Expr expr = and();

    while (match(OR)) {
      Token operator = previous();
      Expr right = and();
      expr = new Expr.Logical(expr, operator, right);
    }

    return expr;
  }
```

它的操作数是位于下一优先级的新的`and`表达式。

_<u>lox/Parser.java，在 or()方法后添加：</u>_

```java
  private Expr and() {
    Expr expr = equality();

    while (match(AND)) {
      Token operator = previous();
      Expr right = equality();
      expr = new Expr.Logical(expr, operator, right);
    }

    return expr;
  }
```

这里会调用 `equality()` 计算操作数，这样一来，表达式解析器又重新绑定到了一起。我们已经准备好进行解释了。

_<u>lox/Interpreter.java，在 visitLiteralExpr()方法后添加：</u>_

```java
  @Override
  public Object visitLogicalExpr(Expr.Logical expr) {
    Object left = evaluate(expr.left);

    if (expr.operator.type == TokenType.OR) {
      if (isTruthy(left)) return left;
    } else {
      if (!isTruthy(left)) return left;
    }

    return evaluate(expr.right);
  }
```

如果你把这个方法与前面章节的`visitBinaryExpr()`方法相比较，就可以看出其中的区别。这里，我们先计算左操作数。然后我们查看结果值，判断是否可以短路。当且仅当不能短路时，我们才计算右侧的操作数。


另一个有趣的部分是决定返回什么实际值。由于 Lox 是动态类型的，我们允许任何类型的操作数，并使用真实性来确定每个操作数代表什么。我们对结果采用类似的推理。逻辑运算符并不承诺会真正返回`true`或`false`，而只是保证它将返回一个具有适当真实性的值。

幸运的是，我们手边就有具有适当真实性的值——即操作数本身的结果，所以我们可以直接使用它们。如：

```javascript
print "hi" or 2; // "hi".
print nil or "yes"; // "yes".
```


在第一行，`“hi”`是真的，所以`or`短路并返回它。在第二行，`nil`是假的，因此它计算并返回第二个操作数`“yes”`。

这样就完成了 Lox 中的所有分支原语，我们准备实现循环吧。

## 9.4 While 循环

Lox 有两种类型的循环控制流语句，分别是`while`和`for`。`while`循环更简单一点，我们先从它开始.

```javascript
statement      → exprStmt
               | ifStmt
               | printStmt
               | whileStmt
               | block ;

whileStmt      → "while" "(" expression ")" statement ;
```

我们在`statement`规则中添加一个子句，指向 while 对应的新规则`whileStmt`。该规则接收一个`while`关键字，后跟一个带括号的条件表达式，然后是循环体对应的语句。新语法规则需要定义新的语法树节点。

_<u>tool/GenerateAst.java,在 main()方法中新增，前一行后添加“,”</u>_

```java
      "Print      : Expr expression",
      "Var        : Token name, Expr initializer",
      // 新增部分开始
      "While      : Expr condition, Stmt body"
      // 新增部分结束
    ));
```

该节点中保存了条件式和循环体。这里就可以看出来为什么表达式和语句最好要有单独的基类。字段声明清楚地表明了，条件是一个表达式，循环主体是一个语句。

在解析器中，我们遵循与`if`语句相同的处理步骤。首先，在 `statement()` 添加一个 case 分支检查并匹配开头的关键字。

_<u>lox/Parser.java，在 statement()方法中添加：</u>_

```java
    if (match(PRINT)) return printStatement();
    // 新增部分开始
    if (match(WHILE)) return whileStatement();
    // 新增部分结束
    if (match(LEFT_BRACE)) return new Stmt.Block(block());
```

实际的工作委托给下面的方法：

_<u>lox/Parser.java，在 varDeclaration()方法后添加：</u>_

```java
  private Stmt whileStatement() {
    consume(LEFT_PAREN, "Expect '(' after 'while'.");
    Expr condition = expression();
    consume(RIGHT_PAREN, "Expect ')' after condition.");
    Stmt body = statement();

    return new Stmt.While(condition, body);
  }
```

语法非常简单，这里将其直接翻译为 Java。说到直接翻译成 Java，下面是我们执行新语法的方式：

_<u>lox/Interpreter.java，在 visitVarStmt()方法后添加：</u>_

```java
  @Override
  public Void visitWhileStmt(Stmt.While stmt) {
    while (isTruthy(evaluate(stmt.condition))) {
      execute(stmt.body);
    }
    return null;
  }
```

和`if`的访问方法一样，这里的访问方法使用了相应的 Java 特性。这个方法并不复杂，但它使 Lox 变得更加强大。我们终于可以编写一个运行时间不受源代码长度严格限制的程序了。

## 9.5 For 循环

我们已经到了最后一个控制流结构，即老式的 C 语言风格`for`循环。我可能不需要提醒你，但还是要说它看起来是这样的：

```java
for (var i = 0; i < 10; i = i + 1) print i;
```

在语法中，是这样的：

```javascript
statement      → exprStmt
               | forStmt
               | ifStmt
               | printStmt
               | whileStmt
               | block ;

forStmt        → "for" "(" ( varDecl | exprStmt | ";" )
                 expression? ";"
                 expression? ")" statement ;
```

在括号内，有三个由分号分隔的子语句：

1. 第一个子句是*初始化式*。它只会在任何其它操作之前执行一次。它通常是一个表达式，但是为了便利，我们也允许一个变量声明。在这种情况下，变量的作用域就是`for`循环的其它部分——其余两个子式和循环体。

2. 接下来是*条件表达式*。与`while`循环一样，这个表达式控制了何时退出循环。它会在每次循环开始之前执行一次（包括第一次）。如果结果是真，就执行循环体；否则，就结束循环。

3. 最后一个子句是*增量式*。它是一个任意的表达式，会在每次循环结束的时候做一些工作。因为表达式的结果会被丢弃，所以它必须有副作用才能有用。在实践中，它通常会对变量进行递增。

这些子语句都可以忽略。在右括号之后是一个语句作为循环体，通常是一个代码块。

### 9.5.1 语法脱糖


这里包含了很多配件，但是请注意，它所做的任何事情中，没有一件是无法用已有的语句实现的。如果`for`循环不支持初始化子句，你可以在`for`语句之前加一条初始化表达式。如果没有增量子语句，你可以直接把增量表达式放在循环体的最后。

换句话说，Lox 不*需要*`for`循环，它们只是让一些常见的代码模式更容易编写。这类功能被称为**语法糖**[^6]。例如，前面的`for`循环可以改写成这样：

```javascript
{
  var i = 0;
  while (i < 10) {
    print i;
    i = i + 1;
  }
}
```


虽然这个脚本不太容易看懂，但这个脚本与之前那个语义完全相同。像 Lox 中的`for`循环这样的语法糖特性可以使语言编写起来更加愉快和高效。但是，特别是在复杂的语言实现中，每一个需要后端支持和优化的语言特性都是代价昂贵的。

我们可以通过**脱糖**来吃这个蛋糕。这个有趣的词描述了这样一个过程：前端接收使用了语法糖的代码，并将其转换成后端知道如何执行的更原始的形式。

我们将把`for`循环脱糖为`while`循环和其它解释器可处理的其它语句。在我们的简单解释器中，脱糖真的不能为我们节省很多工作，但它确实给了我一个契机来向你介绍这一技术。因此，与之前的语句不同，我们不会为`for`循环添加一个新的语法树节点。相反，我们会直接进行解析。首先，先引入一个我们要用到的依赖：

_<u>lox/Parser.java，添加代码：</u>_

```java
import java.util.ArrayList;
// 新增部分开始
import java.util.Arrays;
// 新增部分结束
import java.util.List;
```

像每个语句一样，我们通过匹配`for`关键字来解析循环。

_<u>lox/Parser.java,在 statement()方法中新增：</u>_

```java
  private Stmt statement() {
    // 新增部分开始
    if (match(FOR)) return forStatement();
    // 新增部分结束
    if (match(IF)) return ifStatement();
```

接下来是有趣的部分，脱糖也是在这里发生的，所以我们会一点点构建这个方法，首先从子句之前的左括号开始。

_<u>lox/Parser.java，在 statement()方法后添加：</u>_

```java
  private Stmt forStatement() {
    consume(LEFT_PAREN, "Expect '(' after 'for'.");

    // More here...
  }
```

接下来的第一个子句是初始化式。

_<u>lox/Parser.java，在 forStatement()方法中替换一行：</u>_

```java
    consume(LEFT_PAREN, "Expect '(' after 'for'.");
    // 替换部分开始
    Stmt initializer;
    if (match(SEMICOLON)) {
      initializer = null;
    } else if (match(VAR)) {
      initializer = varDeclaration();
    } else {
      initializer = expressionStatement();
    }
    // 替换部分结束
  }
```

如果`(`后面的标记是分号，那么初始化式就被省略了。否则，我们就检查`var`关键字，看它是否是一个变量声明。如果这两者都不符合，那么它一定是一个表达式。我们对其进行解析，并将其封装在一个表达式语句中，这样初始化器就必定属于 Stmt 类型。

接下来是条件表达式。

_<u>lox/Parser.java，在 forStatement()方法中添加代码：</u>_

```java
      initializer = expressionStatement();
    }
    // 新增部分开始
    Expr condition = null;
    if (!check(SEMICOLON)) {
      condition = expression();
    }
    consume(SEMICOLON, "Expect ';' after loop condition.");
    // 新增部分结束
  }
```

同样，我们查找分号检查子句是否被忽略。最后一个子句是增量语句。

_<u>lox/Parser.java，在 forStatement()方法中添加：</u>_

```java
    consume(SEMICOLON, "Expect ';' after loop condition.");
    // 新增部分开始
    Expr increment = null;
    if (!check(RIGHT_PAREN)) {
      increment = expression();
    }
    consume(RIGHT_PAREN, "Expect ')' after for clauses.");
    // 新增部分结束
  }
```

它类似于条件式子句，只是这个子句是由右括号终止的。剩下的就是循环主体了。

_<u>lox/Parser.java，在 forStatement()方法中添加代码：</u>_

```java
    consume(RIGHT_PAREN, "Expect ')' after for clauses.");
    // 新增部分开始
    Stmt body = statement();

    return body;
    // 新增部分结束
  }
```

我们已经解析了`for`循环的所有部分，得到的 AST 节点也存储在一些 Java 本地变量中。这里也是脱糖开始的地方。我们利用这些变量来合成表示`for`循环语义的语法树节点，就像前面展示的手工脱糖的例子一样。

如果我们从后向前处理，代码会更简单一些，所以我们从增量子句开始。

_<u>lox/Parser.java，在 forStatement()方法中新增：</u>_

```java
    Stmt body = statement();
    // 新增部分开始
    if (increment != null) {
      body = new Stmt.Block(
          Arrays.asList(
              body,
              new Stmt.Expression(increment)));
    }
    // 新增部分结束
    return body;
```

如果存在增量子句的话，会在循环的每个迭代中在循环体结束之后执行。我们用一个代码块来代替循环体，这个代码块中包含原始的循环体，后面跟一个执行增量子语句的表达式语句。

_<u>lox/Parser.java，在 forStatement()方法中新增代码：</u>_

```java
    }
    // 新增部分开始
    if (condition == null) condition = new Expr.Literal(true);
    body = new Stmt.While(condition, body);
    // 新增部分结束
    return body;
```

接下来，我们获取条件式和循环体，并通过基本的`while`语句构建对应的循环。如果条件式被省略了，我们就使用`true`来创建一个无限循环。

_<u>lox/Parser.java，在 forStatement()方法中新增：</u>_

```java
    body = new Stmt.While(condition, body);
    // 新增部分开始
    if (initializer != null) {
      body = new Stmt.Block(Arrays.asList(initializer, body));
    }
    // 新增部分结束
    return body;
```

最后，如果有初始化式，它会在整个循环之前运行一次。我们的做法是，再次用代码块来替换整个语句，该代码块中首先运行一个初始化式，然后执行循环。

就是这样。我们的解释器现在已经支持了 C 语言风格的`for`循环，而且我们根本不需要修改解释器类。因为我们通过脱糖将其转换为了解释器已经知道如何访问的节点，所以无需做其它的工作。

最后，Lox 已强大到足以娱乐我们，至少几分钟。下面是一个打印斐波那契数列前 21 个元素的小程序：

```javascript
var a = 0;
var temp;

for (var b = 1; a < 10000; b = temp + b) {
  print a;
  temp = a;
  a = b;
}
```

[^1]: 其中最著名的就是罗素悖论。最初，集合理论允许你定义任何类型的集合。只要你能用英语描述它，它就是有效的。自然，鉴于数学家对自引用的偏爱，集合可以包含其他的集合。于是，罗素，这个无赖，提出了：<br/>R 是所有不包含自身的集合的集合。<br/>R 是否包含自己？如果不包含，那么根据定义的后半部分，它应该包含；如果包含，那么它就不满足定义。脑袋要炸了。
[^2]: 图灵把他的发明称为 “a-machines”，表示“automatic(自动)”。他并没有自吹自擂到把自己的名字放入其中。后来的数学家们为他做了这些。这就是你如何在成名的同时还能保持谦虚。
[^3]: 我们也基本上具备第三个条件了。你可以创建和拼接任意大小的字符串，因此也就可以存储无界内存。但我们还无法访问字符串的各个部分。
[^4]: 条件操作符也称为三元操作符，因为它是 C 语言中唯一接受三个操作数的操作符。
[^5]: 条件周围的圆括号只有一半是有用的。您需要在条件和 then 语句之间设置某种分隔符，否则解析器无法判断是否到达条件表达式的末尾。但是` if` 后面的小括号并没有什么用处。Dennis Ritchie 把它放在那里是为了让他可以使用` )`作为结尾的分隔符，而且不会出现不对称的小括号。其他语言，比如 Lua 和一些 BASICs，使用`then`这样的关键字作为结束分隔符，在条件表达式之前没有任何内容。而 Go 和 Swift 则要求语句必须是一个带括号的块，这样就可以使用语句开头的`{`来判断条件表达式是否结束。
[^6]: 这个令人愉快的短语是由 Peter J. Landin 在 1964 年创造的，用来描述 ALGOL 等语言支持的一些很好的表达式形式是如何在更基本但可能不太令人满意的 lambda 演算的基础上增添一些小甜头的。

---

## 习题

1、在接下来的几章中，当 Lox 支持一级函数和动态调度时，从技术上讲，我们就不需要在语言中内置分支语句。说明如何用这些特性来实现条件执行。说出一种在控制流中使用这种技术的语言。

2、同样地，只要我们的解释器支持一个重要的优化，循环也可以用这些工具来实现。它是什么？为什么它是必要的？请说出一种使用这种技术进行迭代的语言。

3、与 Lox 不同，大多数其他 C 风格语言也支持循环内部的`break`和`continue`语句。添加对`break`语句的支持。

语法是一个`break`关键字，后面跟一个分号。如果`break`语句出现在任何封闭的循环之后，那就应该是一个语法错误。在运行时，`break`语句会跳转到最内层的封闭循环的末尾，并从那里开始继续执行。注意，`break`语句可以嵌套在其它需要退出的代码块和`if`语句中。

---

## 设计笔记：一些语法糖

当你设计自己的语言时，你可以选择在语法中注入多少语法糖。你是要做一种不加糖、每个语法操作都对应单一的语法单元的健康食品？还是每一点行为都可以用 10 种不同方式实现的堕落的甜点？把这两种情况看作是两端的话，成功的语言分布在这个连续体的每个中间点。

极端尖刻的一侧是那些语法极少的语言，如 Lisp、Forth 和 SmallTalk。Lisp 的拥趸广泛声称他们的语言 "没有语法"，而 Smalltalk 的人则自豪地表示，你可以把整个语法放在一张索引卡上。这个部落的理念是，语言不需要句法糖。相反，它所提供的最小的语法和语义足够强大，足以让库中的代码像语言本身的一部分一样具有表现力。

接近这些的是像 C、Lua 和 Go 这样的语言。他们的目标是简单和清晰，而不是极简主义。有些语言，如 Go，故意避开了语法糖和前一类语言的语法扩展性。他们希望语法不受语义的影响，所以他们专注于保持语法和库的简单性。代码应该是明显的，而不是漂亮的。

介于之间的是 Java、C#和 Python 等语言。最终，你会看到 Ruby、C++、Perl 和 D-语言，它们在语法中塞入了太多的句法规则，以至于键盘上的标点符号都快用完了。

在某种程度上，频谱上的位置与年龄相关。在后续的版本中增加一些语法糖是比较容易的。新的语法很容易让人喜欢，而且与修改语义相比，它更不可能破坏现有的程序。一旦加进去，你就再也不能把它去掉了，所以随着时间的推移，语言会变得越来越甜。从头开始创建一门新语言的主要好处之一是，它给了你一个机会去刮掉那些累积的糖霜并重新开始。

语法糖在 PL 知识分子中名声不佳。那群人对极简主义有一种真正的迷恋。这是有一定道理的。设计不良的、不必要的语法增加了认知负荷，却没有增加相匹配的表达能力。因为一直会有向语言中添加新特性的压力，所以需要自律并专注于简单，以避免臃肿。一旦你添加了一些语法，你就会被它困住，所以明智的做法是要精简。

同时，大多数成功的语言都有相当复杂的语法，至少在它们被广泛使用的时候是这样。程序员在他们所选择的语言上花费了大量的时间，一些随处可见的细节确实可以提高他们工作时的舒适度和效率。

找到正确的平衡——为你的语言选择适当的甜度——取决于你自己的品味。
