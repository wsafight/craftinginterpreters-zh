---
title: 11. 解析和绑定
description: Resolving and Binding
---

> 你也许偶尔会发现自己处于一种奇怪的情况。你曾以最自然的方式逐渐进入其中，但当你身处其中时，你会突然感到惊讶，并问自己这一切到底是怎么发生的。
>
> ​ —— Thor Heyerdahl, _Kon-Tiki_

哦，不! 我们的语言实现正在进水! 在我们刚添加变量和代码块时，我们把作用域控制的很好很严密。但是当我们后来添加闭包之后，我们以前防水的解释器上就出现了一个洞。大多数真正的程序都不可能从这个洞里溜走，但是作为语言实现者，我们要立下神圣的誓言，即使在语义的最深处、最潮湿的角落里也要关心正确性。【译者注：这一段好中二，其实原文中有很多地方都有类似的中二之魂燃烧瞬间】

我们将用整整一章的时间来探索这个漏洞，然后小心翼翼地把它补上。在这个过程中，我们将对 Lox 和其他 C 语言传统中使用的词法范围有一个更严格的理解。我们还将有机会学习语义分析——这是一种强大的技术，用于从用户的源代码中提取语义而无需运行它。

## 11.1 静态作用域

快速复习一下：Lox 和大多数现代语言一样，使用词法作用域。这意味着你可以通过阅读代码文本找到变量名字指向的是哪个声明。例如：

```java
var a = "outer";
{
  var a = "inner";
  print a;
}
```

这里，我们知道打印的`a`是上一行声明的变量，而不是全局变量。运行代码并不会（也不能）影响这一点。作用域规则是语言的静态语义的一部分，这也就是为什么它们被称为静态作用域。

我还没有详细说明这些作用域规则，但是现在是时候详细说明一下了[^1]：

> 变量指向的是使用变量的表达式外围环境中，前面具有相同名称的最内层作用域中的变量声明。\*\*

> 其中有很多东西需要解读：

- 我说的是“变量使用”而不是“变量表达式”，是为了涵盖变量表达式和赋值两种情况。类似于“使用变量的表达式”。

- “前面”意味着出现在*程序文本*之前。

  ```java
  var a = "outer";
  {
    print a;
    var a = "inner";
  }
  ```

  这里，打印的`a`是外层的，因为它在使用该变量的`print`语句之前。在大多数情况下，在单行代码中，文本中靠前的变量声明在时间上也先于变量使用。但并不总是如此。正如我们将看到的，函数可以推迟代码块，以使其动态执行的时间不受静态文本顺序的约束[^2]。

- “最内层”之所以存在，是因为我们的好朋友——变量遮蔽的缘故。在外围作用域中可能存在多个具有给定名称的变量。如：

  ```java
  var a = "outer";
  {
    var a = "inner";
    print a;
  }
  ```

  我们通过优先使用最内层作用域的方式来消除这种歧义。

由于这条规则没有提及任何运行时行为，它意味着一个变量表达式在程序的整个执行过程中总是指向同一声明。到目前为止，我们的解释器基本正确实现了这一规则。但是当我们添加了闭包后，一个错误悄悄出现了。

```java
var a = "global";
{
  fun showA() {
    print a;
  }

  showA();
  var a = "block";
  showA();
}
```

在你执行这段代码之前，先思考一下它*应该*输出什么[^3]。

好的……清楚了吗？如果你熟悉其它语言中的闭包，你可能期望会输出两次“global”。对 `showA() `的第一次调用肯定会打印 “global”，因为我们甚至还没有执行到内部变量 `a` 的声明。而根据我们的规则，一个变量表达式总是解析为同一个变量，这意味着对 `showA() `的第二次调用也应该打印出同样的内容。

唉，它输出的是：

```
global
block
```

我要强调一下，这个代码中从未重新分配任何变量，并且只包含一个`print`语句。然而，不知何故，对于这个从未分配过的变量，`print`语句在不同的时间点上打印了两个不同的值。我们肯定在什么地方出了问题。

### 11.1.1 作用域和可变环境

在我们的解释器中，环境是静态作用域的动态表现。这两者大多情况下保持同步——当我们进入一个新的作用域时，我们会创建一个新的环境，当我们离开这个作用域时，我们会丢弃它。在环境中还有一个可执行的操作：在环境中绑定一个变量。这就是我们的问题所在。

让我们通过这个有问题的例子，看看每一步的环境是什么样的。首先，我们在全局作用域内声明`a`。

![The global environment with 'a' defined in it.](./environment-1.png)

这为我们提供了一个环境，其中只有一个变量。然后我们进入代码块，并执行`showA()`的声明。

![A block environment linking to the global one.](./environment-2.png)

我们得到一个对应该代码块的新环境。在这个环境中，我们声明了一个名称`showA`，它绑定到为表示函数而创建的 LoxFunction 对象。该对象中有一个`closure`字段，用于捕获函数声明时的环境，因此它有一个指向该代码块环境的引用。

现在我们调用`showA()`。

![An empty environment for showA()'s body linking to the previous two. 'a' is resolved in the global environment.](./environment-3.png)

解释器为 showA()的函数体动态地创建了一个新环境。它是空的，因为该函数没有声明任何变量。该环境的父环境是该函数的闭包——外部的代码块环境。

在`showA()`函数体中，输出`a`的值。解释器通过遍历环境链来查找这个值。它会一直到达全局环境，在其中找到变量`a`并打印“global”。太好了。

接下来，我们声明第二个`a`，这次是在代码块内。

![The block environment has both 'a' and 'showA' now.](./environment-4.png)

它和`showA()`在同一个代码块中——同一个作用域，所以它进入了同一个环境，也就是`showA()`的闭包所指向的环境。这就是有趣的地方了。我们再次调用`showA()`。

![An empty environment for showA()'s body linking to the previous two. 'a' is resolved in the block environment.](./environment-5.png)

我们再次为`showA()`的函数体创建了一个新的空环境，将其连接到该闭包，并运行函数体。当解释器遍历环境链去查找`a`时，它会发现代码块环境中新的变量`a`。

我选择了一种实现环境的方式，希望它能够与您对作用域的非正式直觉相一致。我们倾向于认为一个块中的所有代码在同一个作用域中，所以我们的解释器使用了一个环境来表示它。每个环境都是一个可变的 hash 表。当一个新的局部变量被声明时，它会被加入该作用域的现有环境中。

就像生活中的很多直觉一样，这种直觉并不完全正确。一个代码块并不一定都是同一个作用域。考虑一下：

```javascript
{
  var a;
  // 1.
  var b;
  // 2.
}
```

在标记的第一行，作用域中只有`a`。在第二行时，`a`和`b`都在其中。如果将作用域定义为一组声明，那么它们显然不是相同的作用域——它们不包含相同的声明。这就好像是`var`语句将代码块分割成了两个独立的作用域，变量声明前的作用域和包含新变量的作用域[^4]。

但是在我们的实现中，环境确实表现得像整个代码块是一个作用域，只是这个作用域会随时间变化。而闭包不是这样的。当函数被声明时，它会捕获一个指向当前环境的引用。函数*应该*捕获一个冻结的环境快照，就像它存在于函数被声明的那一瞬间。但是事实上，在 Java 代码中，它引用的是一个实际可变的环境对象。当后续在该环境所对应的作用域内声明一个变量时，闭包会看到该变量，即使变量声明*没有*出现在函数之前。

### 11.1.2 持久环境

有一种编程风格，使用所谓的**持久性数据结构**。与你在命令式编程中所熟悉的模糊的数据结构不同，持久化数据结构永远不能被直接修改。相应地，对现有结构的任何 "修改 "都会产生一个全新的对象，其中包含所有的原始数据和新的修改。而原有的对象则保持不变[^5]。

如果我们将这一技术应用于环境，那么每次你声明一个变量时，都会返回一个新的环境，其中包含所有先前声明的变量和一个新名称。声明一个变量会执行隐式分割，在声明变量之前与之后都有一个环境：

![Separate environments before and after the variable is declared.](./environment-6.png)

当函数被声明时，闭包保留对正在运行的 Environment 实例的引用。由于该代码块中后续的任何声明都会生成新的 Environment 对象，闭包就不会看到新的变量，我们的问题也得到修复。

这是解决该问题的合法方式，也是在 Scheme 解释器中实现变量环境的经典方式。对于 Lox，我们可以这样做，但是这意味着要回头修改一大堆现有的代码。

我不会把你拖下水的。我们将保持表示环境的方式不变。我们不会让数据变得更加静态结构化，而是将静态解析嵌入访问操作本身。

## 11.2 语义分析

我们的解释器每次对变量表达式求值时，都会**解析**变量——追踪它所指向的声明。如果这个变量被包在一个运行 1000 次的循环中，那么该变量就会被重复解析 1000 次。

我们知道静态作用域意味着一个变量的使用总是解析到同一个声明，而且可以通过查看文本来确定。既然如此，我们为什么每次都要动态地解析呢？这样做不仅仅导致了这个恼人的 bug，而且也造成了不必要的低效。

一个更好的解决方案是一次性解析每个变量的使用。编写一段代码，检查用户的程序，找到所提到的每个变量，并找出每个变量引用的是哪个声明。这个过程是**语义分析**的一个例子。解析器只能分析程序在语法上是否正确(语法分析)，而语义分析则更进一步，开始弄清楚程序的各个部分的实际含义。在这种情况下，我们的分析将解决变量绑定的问题。我们不仅要知道一个表达式是一个变量，还要知道它是哪个变量。

有很多方法可以存储变量及其声明直接的绑定关系。当我们使用 Lox 的 C 解释器时，我们将有一种更有效的方式来存储和访问局部变量。但是对于 jlox 来说，我想尽量减少对现有代码库的附带损害。我不希望扔掉一堆基本上都很好的代码。

相对地，我们将以最充分利用现有 Environment 类的方式来存储解析结果。回想一下，在有问题的例子中，`a`的访问是如何被解释的。

![An empty environment for showA()'s body linking to the previous two. 'a' is resolved in the global environment.](./environment-3.png)

在第一次（正确的）求值中，我们会检查链中的环境，并找到`a`的全局声明。然后，当内部的`a`在块作用域中声明时，它会遮蔽全局的变量`a`。

![An empty environment for showA()'s body linking to the previous two. 'a' is resolved in the block environment.](./environment-5.png)

下一次查找会遍历环境链，在第二个环境中找到`a`并停止。每个环境都对应于一个声明变量的词法作用域。如果我们能够保证变量查找总是在环境链上遍历相同数量的链接，也就可以保证每次都可以在相同的作用域中找到相同的变量。

要“解析”一个变量使用，我们只需要计算声明的变量在环境链中有多少“跳”。有趣的问题是在什么时候进行这个计算——或者换句话说，在解释器的实现中，这段代码要添加到什么地方？

因为我们是根据源代码的结构来计算一个静态属性，所以答案显然是在解析器中。那是传统的选择，也是我们以后在 clox 中实现它的地方。在这里同样也适用，但是我想给你展示另一种技巧。我们会单独写一个解析器。

### 11.2.1 变量解析过程

在解析器生成语法树之后，解释器执行语法树之前，我们会对语法树再进行一次遍历，以解析其中包含的变量。在解析和执行之间的额外遍历是很常见的。如果 Lox 中有静态类型，我们可以插入一个类型检查器。优化也经常是在类似单独的遍历过程中实现的。基本上，任何不依赖于运行时状态的工作都可以通过这种方式完成。

我们的变量解析工作就像一个小型的解释器。它会遍历整棵树，访问每个节点，但是静态分析与动态执行还是不同的：

- **没有副作用**。当静态分析处理一个`print`语句时，它并不会打印任何东西。对本地函数或其它与外部世界联系的操作也会被终止，并且没有任何影响。

- **没有控制流**。循环只会被处理一次，`if`语句中的两个分支都会处理，逻辑操作符也不会做短路处理[^6]。

## 11.3 Resolver 类

与 Java 中的所有内容一样，我们将变量解析处理也放在一个类中。

_<u>lox/Resolver.java，创建新文件：</u>_

```java
package com.craftinginterpreters.lox;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Stack;

class Resolver implements Expr.Visitor<Void>, Stmt.Visitor<Void> {
  private final Interpreter interpreter;

  Resolver(Interpreter interpreter) {
    this.interpreter = interpreter;
  }
}
```

因为解析器需要处理语法树中的每个节点，所以它实现了我们已有的访问者抽象。在解析变量时，有几个节点是比较特殊的：

- 块语句为它所包含的语句引入了一个新的作用域。

- 函数声明为其函数体引入了一个新的作用域，并在该作用域中绑定了它的形参。

- 变量声明将一个新变量加入到当前作用域中。

- 变量定义和赋值表达式需要解析它们的变量值。

其余的节点不做任何特别的事情，但是我们仍然需要为它们实现 visit 方法，以遍历其子树。尽管`+`表达式本身没有任何变量需要解析，但是它的任一操作数都可能需要。

### 11.3.1 解析代码块

我们从块语法开始，因为它们创建了局部作用域——魔法出现的地方。

_<u>lox/Resolver.java，在 Resolver()方法后添加：</u>_

```java
  @Override
  public Void visitBlockStmt(Stmt.Block stmt) {
    beginScope();
    resolve(stmt.statements);
    endScope();
    return null;
  }
```

这里会开始一个新的作用域，遍历块中的语句，然后丢弃该作用域。有趣的部分都在这些辅助方法中。我们先看一个简单的。

_<u>lox/Resolver.java，在 Resolver()方法后添加：</u>_

```java
  void resolve(List<Stmt> statements) {
    for (Stmt statement : statements) {
      resolve(statement);
    }
  }
```

它会遍历语句列表，并解析其中每一条语句。它会进一步调用：

_<u>lox/Resolver.java，在 visitBlockStmt()方法后添加：</u>_

```java
  private void resolve(Stmt stmt) {
    stmt.accept(this);
  }
```

在此过程中，让我们添加一个后续解析表达式时会用到的重载方法。

_<u>lox/Resolver.java，在 resolve(Stmt stmt)方法后添加：</u>_

```java
  private void resolve(Expr expr) {
    expr.accept(this);
  }
```

这些方法与解释器中的 `evaluate()`和`execute()`方法类似——它们会反过来将访问者模式应用到语法树节点。

真正有趣的部分是围绕作用域的。一个新的块作用域是这样创建的：

_<u>lox/Resolver.java，在 resolve()方法后添加：</u>_

```java
  private void beginScope() {
    scopes.push(new HashMap<String, Boolean>());
  }
```

词法作用域在解释器和解析器中都有使用。它们的行为像一个栈。解释器是使用链表（Environment 对象组成的链）来实现栈的，在解析器中，我们使用一个真正的 Java Stack。

_<u>lox/Resolver.java，在 Resolver 类中添加：</u>_

```java
  private final Interpreter interpreter;
  // 新增部分开始
  private final Stack<Map<String, Boolean>> scopes = new Stack<>();
  // 新增部分结束
  Resolver(Interpreter interpreter) {
```

这个字段会记录当前作用域内的栈。栈中的每个元素是代表一个块作用域的 Map。与 Environment 中一样，键是变量名。值是布尔值，原因我很快会解释。

作用域栈只用于局部块作用域。解析器不会跟踪在全局作用域的顶层声明的变量，因为它们在 Lox 中是更动态的。当解析一个变量时，如果我们在本地作用域栈中找不到它，我们就认为它一定是全局的。

由于作用域被存储在一个显式的栈中，退出作用域很简单。

<u>_lox/Resolver.java，在 beginScope()方法后添加：_</u>

```java
  private void endScope() {
    scopes.pop();
  }
```

现在我们可以在一个栈中压入和弹出一个空作用域，接下来我们往里面放些内容。

### 11.3.2 解析变量声明

解析一个变量声明，会在当前最内层的作用域 map 中添加一个新的条目。这看起来很简单，但是我们需要做一些小动作。

_<u>lox/Resolver.java，在 visitBlockStmt()方法后添加：</u>_

```java
  @Override
  public Void visitVarStmt(Stmt.Var stmt) {
    declare(stmt.name);
    if (stmt.initializer != null) {
      resolve(stmt.initializer);
    }
    define(stmt.name);
    return null;
  }
```

我们将绑定分为两个步骤，先声明，然后定义，以便处理类似下面这样的边界情况：

```javascript
var a = "outer";
{
  var a = a;
}
```

当局部变量的初始化式指向一个与当前声明变量名称相同的变量时，会发生什么？我们有几个选择：

1. **运行初始化式，然后将新的变量放入作用域中。** 在这个例子中，新的局部变量`a`会使用“outer”（全局变量`a`的值）初始化。换句话说，前面的声明脱糖后如下：

   ```javascript
   var temp = a; // Run the initializer.
   var a; // Declare the variable.
   a = temp; // Initialize it.
   ```

2. **将新的变量放入作用域中，然后运行初始化式。** 这意味着你可以在变量被初始化之前观察到它，所以当我们需要计算出它的值时，这个值其实是`nil`。这意味着新的局部变量`a`将被重新初始化为它自己的隐式初始化值`nil`。现在，脱糖后的结果如下：

   ```javascript
   var a; // Define the variable.
   a = a; // Run the initializer.
   ```

3. **在初始化式中引用一个变量是错误的。** 如果初始化式使用了要初始化的变量，则解释器在编译时或运行时都会失败。

前两个选项中是否有用户真正*想要*的？变量遮蔽很少见，而且通常是一个错误，所以根据被遮蔽的变量值来初始化一个遮蔽的变量，似乎不太可能是有意为之。

第二个选项就更没用了。新变量的值总是`nil`。通过名称来引用没有任何意义。你可以使用一个隐式的`nil`来代替。

由于前两个选项可能会掩盖用户的错误，我们将采用第三个选项。此外，我们要将其作为一个编译错误而不是运行时错误。这样一来，在代码运行之前，用户就会收到该问题的警报。

要做到这一点，当我们访问表达式时，我们需要知道当前是否在某个变量的初始化式中。我们通过将绑定拆分为两步来实现。首先是**声明**。

_<u>lox/Resolver.java，在 endScope()方法后添加：</u>_

```java
  private void declare(Token name) {
    if (scopes.isEmpty()) return;

    Map<String, Boolean> scope = scopes.peek();
    scope.put(name.lexeme, false);
  }
```

声明将变量添加到最内层的作用域，这样它就会遮蔽任何外层作用域，我们也就知道了这个变量的存在。我们通过在作用域 map 中将其名称绑定到`false`来表明该变量“尚未就绪”。作用域 map 中与 key 相关联的值代表的是我们是否已经结束了对变量初始化式的解析。

在声明完变量后，我们在变量当前存在但是不可用的作用域中解析变量的初始化表达式。一旦初始化表达式完成，变量也就绪了。我们通过**define**来实现。

_<u>lox/Resolver.java，在 declare()方法后添加：</u>_

```java
  private void define(Token name) {
    if (scopes.isEmpty()) return;
    scopes.peek().put(name.lexeme, true);
  }
```

我们在作用域 map 中将变量的值置为`true`，以标记它已完全初始化并可使用。它有了生命！

### 11.3.3 解析变量表达式

变量声明——以及我们即将讨论的函数声明——会向作用域 map 中写数据。在我们解析变量表达式时，需要读取这些 map。

_<u>lox/Resolver.java，在 visitVarStmt()方法后添加：</u>_

```java
  @Override
  public Void visitVariableExpr(Expr.Variable expr) {
    if (!scopes.isEmpty() &&
        scopes.peek().get(expr.name.lexeme) == Boolean.FALSE) {
      Lox.error(expr.name,
          "Can't read local variable in its own initializer.");
    }

    resolveLocal(expr, expr.name);
    return null;
  }
```

首先，我们要检查变量是否在其自身的初始化式中被访问。这也就是作用域 map 中的值发挥作用的地方。如果当前作用域中存在该变量，但是它的值是`false`，意味着我们已经声明了它，但是还没有定义它。我们会报告一个错误出来。

在检查之后，我们实际上使用了这个辅助方法来解析变量：

_<u>lox/Resolver.java，在 define()方法后添加：</u>_

```java
  private void resolveLocal(Expr expr, Token name) {
    for (int i = scopes.size() - 1; i >= 0; i--) {
      if (scopes.get(i).containsKey(name.lexeme)) {
        interpreter.resolve(expr, scopes.size() - 1 - i);
        return;
      }
    }
  }
```

这看起来很像是 Environment 中对变量求值的代码。我们从最内层的作用域开始，向外扩展，在每个 map 中寻找一个可以匹配的名称。如果我们找到了这个变量，我们就对其解析，传入当前最内层作用域和变量所在作用域之间的作用域的数量。所以，如果变量在当前作用域中找到该变量，则传入 0；如果在紧邻的外网作用域中找到，则传 1。明白了吧。

如果我们遍历了所有的作用域也没有找到这个变量，我们就不解析它，并假定它是一个全局变量。稍后我们将讨论`resolve()`方法的实现。现在，让我们继续浏览其他语法节点。

### 11.3.4 解析赋值表达式

另一个引用变量的表达式就是赋值表达式。解析方法如下：

_<u>lox/Resolver.java，在 visitVarStmt()方法后添加：</u>_

```
  @Override
  public Void visitAssignExpr(Expr.Assign expr) {
    resolve(expr.value);
    resolveLocal(expr, expr.name);
    return null;
  }
```

首先，我们解析右值的表达式，以防它还包含对其它变量的引用。然后使用现有的 `resolveLocal()` 方法解析待赋值的变量。

### 11.3.5 解析函数声明

最后是函数。函数既绑定名称又引入了作用域。函数本身的名称被绑定在函数声明时所在的作用域中。当我们进入函数体时，我们还需要将其参数绑定到函数内部作用域中。

_<u>lox/Resolver.java，在 visitBlockStmt()方法后添加：</u>_

```java
  @Override
  public Void visitFunctionStmt(Stmt.Function stmt) {
    declare(stmt.name);
    define(stmt.name);

    resolveFunction(stmt);
    return null;
  }
```

与`visitVariableStmt()`类似，我们在当前作用域中声明并定义函数的名称。与变量不同的是，我们在解析函数体之前，就急切地定义了这个名称。这样函数就可以在自己的函数体中递归地使用自身。

那么我们可以使用下面的方法来解析函数体：

_<u>lox/Resolver.java，在 resolve()方法后添加：</u>_

```java
  private void resolveFunction(Stmt.Function function) {
    beginScope();
    for (Token param : function.params) {
      declare(param);
      define(param);
    }
    resolve(function.body);
    endScope();
  }
```

这是一个单独的方法，因为我们以后添加类时，还需要使用它来解析 Lox 方法。它为函数体创建一个新的作用域，然后为函数的每个参数绑定变量。

一旦就绪，它就会在这个作用域中解析函数体。这与解释器处理函数声明的方式不同。在*运行时*，声明一个函数不会对函数体做任何处理。直到后续函数被调用时，才会触及主体。在*静态*分析中，我们会立即遍历函数体。

### 11.3.6 解析其它语法树节点

这涵盖了语法中很多有趣的部分。我们处理了声明、读取、写入遍历，创建、销毁作用域的部分。虽然其它部分不受遍历解析的影响，我们也需要为其它语法树节点提供 visit 方法，以便递归到它们的子树。抱歉，这部分内容很枯燥，但请耐心听我讲。我们采用“自上而下”的方式，从语句开始。

一个表达式语句中包含一个需要遍历的表达式。

_<u>lox/Resolver.java，在 visitBlockStmt()方法后添加：</u>_

```java
  @Override
  public Void visitExpressionStmt(Stmt.Expression stmt) {
    resolve(stmt.expression);
    return null;
  }
```

`if`语句包含一个条件表达式，以及一个或两个分支语句。

_<u>lox/Resolver.java，在 visitFunctionStmt()方法后添加：</u>_

```java
  @Override
  public Void visitIfStmt(Stmt.If stmt) {
    resolve(stmt.condition);
    resolve(stmt.thenBranch);
    if (stmt.elseBranch != null) resolve(stmt.elseBranch);
    return null;
  }
```

在这里，我们可以看到解析与解释是不同的。当我们解析`if`语句时，没有控制流。我们会解析条件表达式和两个分支表达式。动态执行则只会进入*正在执行*的分支，而静态分析是保守的——它会分析所有*可能执行*的分支。因为任何一个分支在运行时都可能被触及，所以我们要对两者都进行解析。

与表达式语句类似，`print`语句也包含一个子表达式。

_<u>lox/Resolver.java，在 visitIfStmt()方法后添加：</u>_

```java
  @Override
  public Void visitPrintStmt(Stmt.Print stmt) {
    resolve(stmt.expression);
    return null;
  }
```

`return`语句也是相同的。

_<u>lox/Resolver.java，在 visitPrintStmt()方法后添加：</u>_

```java
  @Override
  public Void visitReturnStmt(Stmt.Return stmt) {
    if (stmt.value != null) {
      resolve(stmt.value);
    }

    return null;
  }
```

与`if`语句一样，对于`while`语句，我们会解析其条件，并解析一次循环体。

_<u>lox/Resolver.java，在 visitVarStmt()方法后添加：</u>_

```java
  @Override
  public Void visitWhileStmt(Stmt.While stmt) {
    resolve(stmt.condition);
    resolve(stmt.body);
    return null;
  }
```

这样就涵盖了所有的语句。接下来是表达式……

我们的老朋友二元表达式。我们要遍历并解析两个操作数。

_<u>lox/Resolver.java，在 visitAssignExpr()方法后添加：</u>_

```java
  @Override
  public Void visitBinaryExpr(Expr.Binary expr) {
    resolve(expr.left);
    resolve(expr.right);
    return null;
  }
```

调用也是类似的——我们遍历参数列表并解析它们。被调用的对象也是一个表达式（通常是一个变量表达式），所以它也会被解析。

_<u>lox/Resolver.java，在 visitBinaryExpr()方法后添加：</u>_

```java
  @Override
  public Void visitCallExpr(Expr.Call expr) {
    resolve(expr.callee);

    for (Expr argument : expr.arguments) {
      resolve(argument);
    }

    return null;
  }
```

括号表达式比较简单。

_<u>lox/Resolver.java，在 visitCallExpr()方法后添加：</u>_

```java
  @Override
  public Void visitGroupingExpr(Expr.Grouping expr) {
    resolve(expr.expression);
    return null;
  }
```

字面量表达式是最简单的。

_<u>lox/Resolver.java，在 visitGroupingExpr()方法后添加：</u>_

```java
  @Override
  public Void visitLiteralExpr(Expr.Literal expr) {
    return null;
  }
```

字面表达式中没有使用任何变量，也不包含任何子表达式，所以也不需要做任何事情。

因为静态分析没有控制流或短路处理，逻辑表达式与其它的二元运算符是一样的。

_<u>lox/Resolver.java，在 visitLiteralExpr()方法后添加：</u>_

```java
  @Override
  public Void visitLogicalExpr(Expr.Logical expr) {
    resolve(expr.left);
    resolve(expr.right);
    return null;
  }
```

接下来是最后一个节点，我们解析它的一个操作数。

_<u>lox/Resolver.java，在 visitLogicalExpr()方法后添加：</u>_

```java
  @Override
  public Void visitUnaryExpr(Expr.Unary expr) {
    resolve(expr.right);
    return null;
  }
```

有了这些 visit 方法，Java 编译器应该会认为 Resolver 完全实现了 Stmt.Visitor 和 Expr.Visitor。现在是时候休息一下了。

## 11.4 解释已解析的变量

让我们看看解析器有什么用处。每次访问一个变量时，它都会告诉解释器，在当前作用域和变量定义的作用域之间隔着多少层作用域。在运行时，这正好对应于当前环境与解释器可以找到变量值的外围环境之间的*environments*数量。解析器通过调用下面的方法将这个数字传递给解释器：

_<u>lox/Interpreter.java，在 execute()方法后添加：</u>_

```java
  void resolve(Expr expr, int depth) {
    locals.put(expr, depth);
  }
```

我们要把解析信息存储在某个地方，这样在执行变量表达式和赋值表达式时就可以使用它，但是要存在哪里呢？一个明显的位置就是语法树节点本身。这是一个很好的方法，许多编译器都是在这里存储类似的分析结果的。

我们可以这样做，但是需要对我们的语法树生成器进行修改。相反，我们会采用另一种常见的方法，将其存储在一个 map 中，将每个语法树节点与其解析的数据关联起来。

像 IDE 这种的交互式工具经常会增量地对用户的部分代码进行重新分析和解析。当这些状态隐藏在语法树的枝叶中时，可能很难找到所有需要重新计算的状态。将这些数据存储在节点之外的好处之一就是，可以很容易地丢弃这部分数据——只需要清除 map 即可。

_lox/Interpreter.java_，在 *Interpreter*类中添加

```java
  private Environment environment = globals;
  // 新增部分开始
  private final Map<Expr, Integer> locals = new HashMap<>();
  // 新增部分结束
  Interpreter() {
```

你可能认为我们需要某种嵌套的树状结构，以避免在有多个表达式引用同一个变量时出现混乱，但是每个表达式节点都有其对应的 Java 对象，具有唯一性标识。一个简单的 map 就足以将它们全部区分开来。

与之前一样，使用集合需要先引入一些包名称。

_<u>lox/Interpreter.java，添加：</u>_

```java
import java.util.ArrayList;
// 新增部分开始
import java.util.HashMap;
// 新增部分结束
import java.util.List;
```

还有：

_<u>lox/Interpreter.java，添加：</u>_

```java
import java.util.List;
// 新增部分开始
import java.util.Map;
// 新增部分结束
class Interpreter implements Expr.Visitor<Object>,
```

### 11.4.1 访问已解析的变量

我们的解释器现在可以访问每个变量的解析位置。最后，我们可以利用这一点了，将变量表达式的 visit 方法替换如下：

_<u>lox/Interpreter.java，在 visitVariableExpr()方法中替换一行：</u>_

```java
  public Object visitVariableExpr(Expr.Variable expr) {
    // 替换部分开始
    return lookUpVariable(expr.name, expr);
    // 替换部分结束
  }
```

这里引用了：

_<u>lox/Interpreter.java，在 visitVariableExpr()方法后添加：</u>_

```java
  private Object lookUpVariable(Token name, Expr expr) {
    Integer distance = locals.get(expr);
    if (distance != null) {
      return environment.getAt(distance, name.lexeme);
    } else {
      return globals.get(name);
    }
  }
```

这里有几件事要做。首先，我们在 map 中查找已解析的距离值。要记住，我们只解析了本地变量。全局变量被特殊处理了，不会出现了 map 中（所以它的名字叫`locals`）。所以，如果我们没有在 map 中找到变量对应的距离值，它一定是全局变量。在这种情况下，我们直接在全局 environment 中查找。如果变量没有被定义，就会产生一个运行时错误。

如果我们*确实*查到了一个距离值，那这就是个局部变量，我们可以利用静态分析的结果。我们不会调用`get()`方法，而是调用下面这个 Environment 中的新方法：

_<u>lox/Environment.java，在 define()方法后添加：</u>_

```java
  Object getAt(int distance, String name) {
    return ancestor(distance).values.get(name);
  }
```

原先的`get()`方法会动态遍历外围的环境链，搜索每一个环境，查看变量是否包含在其中。但是现在我们明确知道链路中的哪个环境中会包含该变量。我们使用下面的辅助方法直达这个环境：

_<u>lox/Environment.java，在 define()方法后添加：</u>_

```java
  Environment ancestor(int distance) {
    Environment environment = this;
    for (int i = 0; i < distance; i++) {
      environment = environment.enclosing;
    }

    return environment;
  }
```

该方法在环境链中经过确定的跳数之后，返回对应的环境。一旦我们有了环境，`getAt()`方法就可以直接返回对应环境 map 中的变量值。甚至不需要检查变量是否存在——我们知道它是存在的，因为解析器之前已经确认过了[^7]。

### 11.4.2 赋值已解析的变量

我们也可以通过赋值来使用一个变量。赋值表达式对应的 visit 方法的修改也是类似的。

_<u>lox/Interpreter.java，在 visitAssignExpr()方法中替换一行：</u>_

```java
  public Object visitAssignExpr(Expr.Assign expr) {
    Object value = evaluate(expr.value);
    // 替换部分开始
    Integer distance = locals.get(expr);
    if (distance != null) {
      environment.assignAt(distance, expr.name, value);
    } else {
      globals.assign(expr.name, value);
    }
    // 替换部分结束
    return value;
```

又一次，我们要查找变量的作用域距离。如果没有找到，我们就假定它是全局变量并采用跟之前一样的方式来处理；否则，我们使用下面的新方法：

_<u>lox/Environment.java，在 getAt()方法后添加：</u>_

```java
  void assignAt(int distance, Token name, Object value) {
    ancestor(distance).values.put(name.lexeme, value);
  }
```

正如`getAt()` 与`get()`的关系，`assignAt()` 对应于`assign()`。它会遍历固定数量的环境，然后在其 map 中塞入新的值。

解释器就只需要做这些调整。这也就是为什么我为解析数据选择了一种侵入性最小的表示方法。其余所有节点都跟之前一样，甚至连修改环境的代码也没有改动。

### 11.4.3 运行解析器

不过，我们确实需要*运行*解析器。我们在解析器完成工作之后插入一次解析器处理。

_<u>lox/Lox.java，在 run()方法中添加代码：</u>_

```java
    // Stop if there was a syntax error.
    if (hadError) return;
    // 新增部分开始
    Resolver resolver = new Resolver(interpreter);
    resolver.resolve(statements);
    // 新增部分结束
    interpreter.interpret(statements);
```

如果前面的分析中存在任何错误，我们都不会运行解析器。如果代码有语法错误，它就不会运行，所以解析它的价值不大。如果语法是干净的，我们就告诉解析器做该做的事。解析器中有一个对解释器的引用，当它遍历变量时，会将解析数据直接放入解释器中。解释器后续运行时，它就具备了所需的一切数据。

退一步讲，如果解析器成功了，这么说就是对的。但是如果解析过程中出现错误会怎么办？

## 11.5 解析错误

由于我们正在进行语义分析，因此我们有机会使 Lox 的语义更加精确，以帮助用户在执行代码之前及早发现错误。看一下下面这个坏代码：

```javascript
fun bad() {
  var a = "first";
  var a = "second";
}
```

我们确实允许在*全局*作用域内声明多个同名的变量，但在局部作用域内这样做可能是错误的。如果用户知道变量已经存在，就应该使用赋值操作而不是`var`。如果他们不知道变量的存在，他们可能并不想覆盖之前的变量。

我们可以在解析的时候静态地检测到这个错误。

_<u>lox/Resolver.java，在 declare()方法中添加：</u>_

```java
    Map<String, Boolean> scope = scopes.peek();
    // 新增部分开始
    if (scope.containsKey(name.lexeme)) {
      Lox.error(name,
          "Already variable with this name in this scope.");
    }
    // 新增部分结束
    scope.put(name.lexeme, false);
```

当我们在局部作用域中声明一个变量时，我们已经知道了之前在同一作用域中声明的每个变量的名字。如果我们看到有冲突，我们就报告一个错误。

### 11.5.1 无效返回错误

这是另一个讨人厌的小脚本：

```java
return "at top level";
```

这里执行了一个`return`语句，但它甚至根本不在函数内部。这是一个顶层代码。我不知道用户认为会发生什么，但是我认为我们不希望 Lox 允许这种做法。

我们可以对解析器进行扩展来静态检测这种错误。就像我们遍历语法树时跟踪作用域一样，我们也可以跟踪当前访问的代码是否在一个函数声明内部。

_<u>lox/Resolver.java，在 Resolver 类中添加代码：</u>_

```java
  private final Stack<Map<String, Boolean>> scopes = new Stack<>();
  // 新增部分开始
  private FunctionType currentFunction = FunctionType.NONE;
  // 新增部分结束
  Resolver(Interpreter interpreter) {
```

我们不是使用一个简单的 Boolean 值，而是使用下面这个有趣的枚举：

_<u>lox/Resolver.java，在 Resolver()方法后添加：</u>_

```
  private enum FunctionType {
    NONE,
    FUNCTION
  }
```

现在看来又点蠢，但是我们稍后会添加更多案例，到时候它将更有意义。当我们解析函数声明时，将其作为参数传入。

_<u>lox/Resolver.java，在 visitFunctionStmt()方法中，替换一行：</u>_

```java
    define(stmt.name);
    // 替换部分开始
    resolveFunction(stmt, FunctionType.FUNCTION);
    // 替换部分结束
    return null;
```

在`resolveFunction()`中，我们接受该参数，并在解析函数体之前将其保存在字段中。

_<u>lox/Resolver.java，在 resolveFunction()方法中替换一行：</u>_

```java
  // 替换部分开始
    private void resolveFunction(
      Stmt.Function function, FunctionType type) {
    FunctionType enclosingFunction = currentFunction;
    currentFunction = type;
    // 替换部分结束
    beginScope();
```

我们先把该字段的旧值存在一个局部变量中。记住，Lox 中有局部函数，所以你可以任意深度地嵌套函数声明。我们不仅需要跟踪是否在一个函数内部，还要记录我们在*多少*函数内部。

我们可以使用一个显式的 FunctionType 值堆栈来进行记录，但我们会借助 JVM 的力量。我们将前一个值保存在 Java 堆栈中的一个局部变量。当我们完成函数体的解析之后，我们将该字段恢复为之前的值。

_<u>lox/Resolver.java，在 resolveFunction()方法中添加代码：</u>_

```java
    endScope();
    // 新增部分开始
    currentFunction = enclosingFunction;
    // 新增部分结束
  }
```

既然我们能知道是否在一个函数声明中，那我们就可以在解析`return`语句时进行检查。

_<u>lox/Resolver.java，在 visitReturnStmt()方法中添加代码：</u>_

```java
  public Void visitReturnStmt(Stmt.Return stmt) {
    // 新增部分开始
    if (currentFunction == FunctionType.NONE) {
      Lox.error(stmt.keyword, "Can't return from top-level code.");
    }
    // 新增部分结束
    if (stmt.value != null) {
```

很简洁，对吧？

还有一件事。回到将所有部分整合到一起的主类 Lox 中，我们很小心，如果遇到任何解析错误就不会运行解释器。这个检查是在解析器*之前*运行的，这样我们就不需要再去尝试解析语法无效的代码。

但是如果在解析变量时存在错误，也需要跳过解释器，所以我们添加*另一个*检查。

_<u>lox/Lox.java，在 run()方法中添加代码：</u>_

```java
    resolver.resolve(statements);
    // 新增部分开始
    // Stop if there was a resolution error.
    if (hadError) return;
    // 新增部分结束
    interpreter.interpret(statements);
```

你可以想象在这里做很多其它分析。例如，我们在 Lox 中添加了`break`语句，而我们可能想确保它只能在循环体中使用。

我们还可以更进一步，对那些不一定是错误但可能没有用的代码提出警告。举例来说，如果在`return`语句后有不可触及的代码，很多 IDE 都会发出警告，或者是一个局部变量的值从没有被使用过。所有这些都可以很简单地添加到我们的静态分析过程中，或者作为单独的分析过程[^8]。

但是，就目前而言，我们会坚持这种有限的分析。重要的是，我们修复了一个奇怪又烦人的边界情况 bug，尽管花费了这么多精力可能有些令人意外。

[^1]: 这还远远比不上真正的语言规范那么精确。那些规范文档必须非常明确，即使是一个火星人或一个完全恶意的程序员也会被迫执行正确的语义，只要他们遵循规范说明。有一些公司希望自己的产品与其它产品不兼容，从而将用户锁定在自己的平台上，当一种语言由这类公司实现时，精确性就非常重要了。对于这本书来说，我们很庆幸可以忽略那些尔虞我诈。
[^2]: 在 JavaScript 中，使用 var 声明的变量被隐式提升到块的开头，在代码块中对该名称的任何使用都将指向该变量，即使变量使用出现在声明之前。当你用 JavaScript 写如下代码时：`{  console.log(a);  var a = "value"; }`。它实际相当于：`{  var a; // Hoist.  console.log(a);  a = "value"; }`。这意味着在某些情况下，您可以在其初始化程序运行之前读取一个变量——一个令人讨厌的错误源。后来添加了用于声明变量的备用`let`语法来解决这个问题。
[^3]: 我知道，这完全是一个病态的、人为的程序。这太奇怪了。没有一个理性的人会写这样的代码。唉，如果你长期从事编程语言的工作，你的生活中会有比你想象的更多的时间花在处理这种古怪的代码片段上。
[^4]: 一些语言中明确进行了这种分割。在 Scheme 和 ML 中，当你用`let`声明一个局部变量时，还描述了新变量在作用域内的后续代码。不存在隐含的 “块的其余部分”。
[^5]: 为每个操作复制结构，这听起来可能会浪费大量的内存和时间。在实践中，持久性数据结构在不同的“副本”之间共享大部分的数据。
[^6]: 变量解析对每个节点只触及一次，因此其性能是*O(n)*，其中 n 是语法树中节点的个数。更复杂的分析可能会有更大的复杂性，但是大多数都被精心设计成线性或接近线性。如果编译器随着用户程序的增长而呈指数级变慢，那将是一个很尴尬的失礼。
[^7]: 解释器假定变量在 map 中存在的做法有点像是盲飞。解释器相信解析器完成了工作并正确地解析了变量。这意味着这两个类之间存在深度耦合。在解析器中，涉及作用域的每一行代码都必须与解释器中修改环境的代码完全匹配。我对这种耦合有切身体会，因为当我在为本书写代码时，我遇到了几个微妙的错误，即解析器代码和解释器代码有点不同步。跟踪这些问题是很困难的。一个行之有效的方法就是，在解释器中使用显式的断言——通过 Java 的 assert 或其它验证工具——确认解析器已经具备它所期望的值。
[^8]: 要选择将多少个不同的静态分析纳入单个处理过程中是很困难的。许多小的、孤立的过程（每个过程都有自己的职责）实现和维护都比较简单。然而，遍历语法树本身是有实际运行时间成本的，所以将多个分析绑定到一个过程中通常会更快。

---

## 习题

1、为什么先定义与函数名称绑定的变量是安全的，而其它变量必须等到初始化后才能使用？

2、你知道其它语言中是如何处理局部变量在初始化式中引用了相同名称变量的情况？比如：

```javascript
var a = "outer";
{
  var a = a;
}
```

这是一个运行时错误？编译错误？还是允许这种操作？它们对待全局变量的方式有区别吗？你是否认同它们的选择？证明你的答案。

3、对解析器进行扩展，如果局部变量没有被使用就报告一个错误。

4、我们的解析器会计算出变量是在哪个环境中找到的，但是它仍然需要根据名称在对应的 map 中查找。一个更有效的环境表示形式是将局部变量保存在一个数组中，并通过索引来查找它们。

扩展解析器，为作用域中声明的每个局部变量关联一个唯一的索引。当解析一个变量的访问时，查找变量所在的作用域及对应的索引，并保存起来。在解释器中，使用这个索引快速的访问一个变量。
