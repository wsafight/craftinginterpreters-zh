---
title: 05. 表示代码
description: Representing Code
---

> 对于森林中的居民来说，几乎每一种树都有它的声音和特点。
>
> ​ —— Thomas Hardy, _Under the Greenwood Tree_

在上一章中，我们以字符串形式接收原始源代码，并将其转换为一个稍高级别的表示：一系列词法标记。我们在下一章中要编写的解析器，会将这些词法标记再次转换为更丰富、更复杂的表示形式。

在我们能够输出这种表示形式之前，我们需要先对其进行定义。这就是本章的主题[^1]。在这一过程中，我们将围绕形式化语法进行一些理论讲解，感受函数式编程和面向对象编程的区别，会介绍几种设计模式，并进行一些元编程。

在做这些事情之前，我们先关注一下主要目标——代码的表示形式。它应该易于解析器生成，也易于解释器使用。如果您还没有编写过解析器或解释器，那么这样的需求描述并不能很好地说明问题。也许你的直觉可以帮助你。当你扮演一个*人类*解释器的角色时，你的大脑在做什么？你如何在心里计算这样的算术表达式：

```js
1 + 2 * 3 - 4;
```

因为你已经理解了操作的顺序——以前的“[Please Excuse My Dear Aunt Sally](https://en.wikipedia.org/wiki/Order_of_operations#Mnemonics)”之类[^2]，你知道乘法在加减操作之前执行。有一种方法可以将这种优先级进行可视化，那就是使用树[^3]。叶子节点是数字，内部节点是运算符，它们的每个操作数都对应一个分支。

要想计算一个算术节点，你需要知道它的子树的数值，所以你必须先计算子树的结果。这意味着要从叶节点一直计算到根节点——*后序*遍历：

![Evaluating the tree from the bottom up.](./tree-evaluate.png)

- A.从完整的树开始，先计算最下面的操作`2*3`；
- B.现在计算`+`；
- C.接下来，计算`-`；
- D.最终得到答案。

如果我给你一个算术表达式，你可以很容易地画出这样的树；给你一棵树，你也可以毫不费力地进行计算。因此，从直观上看，我们的代码的一种可行的表示形式是一棵与语言的语法结构（运算符嵌套）相匹配的树。

那么我们需要更精确地了解这个语法是什么。就像上一章的词汇语法一样，围绕句法语法也有一大堆理论。我们要比之前处理扫描时投入更多精力去研究这个理论，因为它在整个解释器的很多地方都是一个有用的工具。我们先从[乔姆斯基谱系](https://en.wikipedia.org/wiki/Chomsky_hierarchy)中往上升一级……

## 5.1 上下文无关语法

在上一章中，我们用来定义词法语法（字符如何被分组为词法标记的规则）的形式体系，被称为*正则语言*。这对于我们的扫描器来说没什么问题，因为它输出的是一个扁平的词法标记序列。但正则语言还不够强大，无法处理可以任意深度嵌套的表达式。

我们还需要一个更强大的工具，就是上下文无关语法(**context-free grammar**，CFG)。它是[形式化语法](https://en.wikipedia.org/wiki/Formal_grammar)的工具箱中下一个最重的工具。一个形式化语法需要一组原子片段，它称之为 "alphabet（字母表）"。然后它定义了一组（通常是无限的）"strings（字符串）"，这些字符串 "包含"在语法中。每个字符串都是字母表中 "letters（字符）"的序列。

我这里使用引号是因为当你从词法转到文法语法时，这些术语会让你有点困惑。在我们的扫描器词法中，alphabet（字母表）由单个字符组成，strings（字符串）是有效的词素（粗略的说，就是“单词”）。在现在讨论的句法语法中，我们处于一个不同的粒度水平。现在，字母表中的一个“letters（字符）”是一个完整的词法标记，而“strings（字符串）”是一个词法标记系列——一个完整的表达式。

嗯，使用表格可能更有助于理解：

| 术语            |     | 词法           | 语法     |
| --------------- | --- | -------------- | -------- |
| 字母表是        | →   | 字符           | 词法标记 |
| 字符串是        | →   | 词素或词法标记 | 表达式   |
| 它是由...实施的 | →   | 扫描器         | 解析器   |

形式化语法的工作是指定哪些字符串有效，哪些无效。如果我们要为英语句子定义一个语法，"eggs are tasty for breakfast "会包含在语法中，但 "tasty breakfast for are eggs "可能不会。

### 5.1.1 语法规则

我们如何写下一个包含无限多有效字符串的语法?我们显然无法一一列举出来。相反，我们创建了一组有限的规则。你可以把它们想象成一场你可以朝两个方向“玩”的游戏。

如果你从规则入手，你可以用它们*生成*语法中的字符串。以这种方式创建的字符串被称为**推导式**（派生式），因为每个字符串都是从语法规则中*推导*出来的。在游戏的每一步中，你都要选择一条规则，然后按照它告诉你的去做。围绕形式化语法的大部分语言都倾向这种方式。规则被称为**生成式**，因为它们生成了语法中的字符串。

上下文无关语法中的每个生成式都有一个**头部**（其名称）和描述其生成内容的**主体**[^4]。在纯粹的形式上看，主体只是一系列符号。符号有两种：

- **终止符**是语法字母表中的一个字母。你可以把它想象成一个字面值。在我们定义的语法中，终止符是独立的词素——来自扫描器的词法标记，比如 `if` 或 `1234`。

  这些词素被称为“终止符”，表示“终点”，因为它们不会导致游戏中任何进一步的 "动作"。你只是简单地产生了那一个符号。

- 非终止符是对语法中另一条规则的命名引用。它的意思是 "执行那条规则，然后将它产生的任何内容插入这里"。这样，语法就构成了。

还有最后一个细节：你可以有多个同名的规则。当你遇到一个该名字的非终止符时，你可以为它选择任何一条规则，随您喜欢。

为了让这个规则具体化，我们需要一种方式来写下这些生成规则。人们一直试图将语法具体化，可以追溯到 Pāṇini 的*Ashtadhyayi*，他在几千年前编纂了梵文语法。直到约翰-巴库斯（John Backus）和公司需要一个声明 ALGOL 58 的符号，并提出了[巴科斯范式](https://en.wikipedia.org/wiki/Backus%E2%80%93Naur_form)（**BNF**），才有了很大的进展。从那时起，几乎每个人都在使用 BNF 的某种变形，并根据自己的需要进行了调整[^5]。

我试图提出一个简单的形式。 每个规则都是一个名称，后跟一个箭头（`→`），后跟一系列符号，最后以分号（`;`）结尾。 终止符是带引号的字符串，非终止符是小写的单词。

以此为基础，下面是一个早餐菜单语法：

```js
breakfast  → protein "with" breakfast "on the side" ;
breakfast  → protein ;
breakfast  → bread ;

protein    → crispiness "crispy" "bacon" ;
protein    → "sausage" ;
protein    → cooked "eggs" ;

crispiness → "really" ;
crispiness → "really" crispiness ;

cooked     → "scrambled" ;
cooked     → "poached" ;
cooked     → "fried" ;

bread      → "toast" ;
bread      → "biscuits" ;
bread      → "English muffin" ;
```

我们可以使用这个语法来随机生成早餐。我们来玩一轮，看看它是如何工作的。按照老规矩，游戏从语法中的第一个规则开始，这里是`breakfast`。它有三个生成式，我们随机选择第一个。我们得到的字符串是这样的：

```js
protein "with" breakfast "on the side"
```

我们需要展开第一个非终止符，`protein`，所有我们要选择它对应的一个生成式。我们选：

```js
protein → cooked "eggs" ;
```

接下来，我们需要 `cooked`的生成式，我们选择 `"poached"`。这是一个终止符，我们加上它。现在我们的字符串是这样的：

```js
"poached" "eggs" "with" breakfast "on the side"
```

下一个非终止符还是`breakfast` ，我们开始选择的`breakfast` 生成式递归地指向了`breakfast` 规则[^6]。语法中的递归是一个很好的标志，表明所定义的语言是上下文无关的，而不是正则的。特别是，递归非终止符两边都有生成式的递归，意味着语言不是正则的。

我们可以不断选择`breakfast` 的第一个生成式，以做出各种各样的早餐：“bacon with sausage with scrambled eggs with bacon . . . ”，【存疑，按照规则设置，这里应该不会出现以 bacon 开头的字符串，原文可能有误】但我们不会这样做。这一次我们选择`bread`。有三个对应的规则，每个规则只包含一个终止符。我们选 "English muffin"。

这样一来，字符串中的每一个非终止符都被展开了，直到最后只包含终止符，我们就剩下：

!["Playing" the grammar to generate a string.](./breakfast.png)

再加上一些火腿和荷兰酱，你就得到了松饼蛋。

每当我们遇到具有多个结果的规则时，我们都只是随意选择了一个。 正是这种灵活性允许用少量的语法规则来编码出组合性更强的字符串集。一个规则可以直接或间接地引用它自己，这就更提高了它的灵活性，让我们可以将无限多的字符串打包到一个有限的语法中。

### 5.1.2 增强符号

在少量的规则中可以填充无限多的字符串是相当奇妙的，但是我们可以更进一步。我们的符号是可行的，但有点乏味。所以，就像所有优秀的语言设计者一样，我们会在上面撒一些语法糖。除了终止符和非终止符之外，我们还允许在规则的主体中使用一些其他类型的表达式：

我们将允许一系列由管道符(`|`)分隔的生成式，避免在每次在添加另一个生成式时重复规则名称。

```js
bread → "toast" | "biscuits" | "English muffin" ;
```

此外，我们允许用括号进行分组，然后在分组中可以用`|`表示从一系列生成式中选择一个。

```js
protein → ( "scrambled" | "poached" | "fried" ) "eggs" ;
```

使用递归来支持符号的重复序列有一定的吸引力，但每次我们要循环的时候，都要创建一个单独的命名子规则，有点繁琐[^7]。所以，我们也使用后缀`*`来允许前一个符号或组重复零次或多次。

```js
crispiness → "really" "really"* ;
```

后缀`+`与此类似，但要求前面的生成式至少出现一次。

```js
crispiness → "really"+ ;
```

后缀`？`表示可选生成式，它之前的生成式可以出现零次或一次，但不能出现多次。

```js
breakfast → protein ( "with" breakfast "on the side" )? ;
```

有了所有这些语法上的技巧，我们的早餐语法浓缩为：

```js
breakfast → protein ( "with" breakfast "on the side" )?
          | bread ;

protein   → "really"+ "crispy" "bacon"
          | "sausage"
          | ( "scrambled" | "poached" | "fried" ) "eggs" ;

bread     → "toast" | "biscuits" | "English muffin" ;
```

我希望还不算太坏。如果你习惯使用 grep 或在你的文本编辑器中使用[正则表达式](https://en.wikipedia.org/wiki/Regular_expression#Standards)，大多数的标点符号应该是熟悉的。主要区别在于，这里的符号代表整个标记，而不是单个字符。

在本书的其余部分中，我们将使用这种表示法来精确地描述 Lox 的语法。当您使用编程语言时，您会发现上下文无关的语法(使用此语法或[EBNF](https://en.wikipedia.org/wiki/Extended_Backus%E2%80%93Naur_form)或其他一些符号)可以帮助您将非正式的语法设计思想具体化。它们也是与其他语言黑客交流语法的方便媒介。

我们为 Lox 定义的规则和生成式也是我们将要实现的树数据结构（用于表示内存中的代码）的指南。 在此之前，我们需要为 Lox 编写一个实际的语法，或者至少要有一个足够上手的语法。

### 5.1.3 Lox 表达式语法

在上一章中，我们一气呵成地完成了 Lox 的全部词汇语法，包括每一个关键词和标点符号。但句法语法的规模更大，如果在我们真正启动并运行解释器之前，就要把整个语法啃完，那就太无聊了。

相反，我们将在接下来的几章中摸索该语言的一个子集。一旦我们可以对这个迷你语言进行表示、解析和解释，那么在之后的章节中将逐步为它添加新的特性，包括新的语法。现在，我们只关心几个表达式：

**字面量**。数字、字符串、布尔值以及`nil`。

**一元表达式**。前缀`!`执行逻辑非运算，`-`对数字求反。

**二元表达式**。我们已经知道的中缀算术符（`+，-，*，/`）和逻辑运算符（`==，！=，<，<=，>，> =`）。

**括号**。表达式前后的一对`（`和`）`。

这已经为表达式提供了足够的语法，例如：

```
1 - (2 * 3) < 4 == false
```

使用我们的新符号，下面是语法的表示：

```js
expression     → literal
               | unary
               | binary
               | grouping ;

literal        → NUMBER | STRING | "true" | "false" | "nil" ;
grouping       → "(" expression ")" ;
unary          → ( "-" | "!" ) expression ;
binary         → expression operator expression ;
operator       → "==" | "!=" | "<" | "<=" | ">" | ">="
               | "+"  | "-"  | "*" | "/" ;
```

这里有一点额外的元语法。除了与精确词素相匹配的终止符会加引号外，我们还对表示单一词素的终止符进行`大写化`，这些词素的文本表示方式可能会有所不同。`NUMBER`是任何数字字面量，`STRING`是任何字符串字面量。稍后，我们将对`IDENTIFIER`进行同样的处理[^8]。

这个语法实际上是有歧义的，我们在解析它时就会看到这一点。但现在这已经足够了。

## 5.2 实现语法树

最后，我们要写一些代码。这个小小的表达式语法就是我们的骨架。由于语法是递归的——请注意`grouping`, `unary`, 和 `binary` 都是指回`expression`的——我们的数据结构将形成一棵树。因为这个结构代表了我们语言的语法，所以叫做**语法树**[^9]。

我们的扫描器使用一个单一的 Token 类来表示所有类型的词素。为了区分不同的种类——想想数字 `123` 和字符串 `"123"`——我们创建了一个简单的 TokenType 枚举。语法树并不是那么同质的[^10]。一元表达式只有一个操作数，二元表达式有两个操作数，而字面量则没有。

我们*可以*将所有这些内容整合到一个包含任意子类列表的 Expression 类中。有些编译器会这么做。但我希望充分利用 Java 的类型系统。所以我们将为表达式定义一个基类。然后，对于每一种表达式——`expression`下的每一个生成式——我们创建一个子类，这个子类有该规则所特有的非终止符字段。这样，如果试图访问一元表达式的第二个操作数，就会得到一个编译错误。

类似这样[^11]：

```java
package com.craftinginterpreters.lox;

abstract class Expr {
  static class Binary extends Expr {
    Binary(Expr left, Token operator, Expr right) {
      this.left = left;
      this.operator = operator;
      this.right = right;
    }

    final Expr left;
    final Token operator;
    final Expr right;
  }

  // Other expressions...
}
```

Expr 是所有表达式类继承的基类。从`Binary`中可以看到，子类都嵌套在它的内部。这在技术上没有必要，但它允许我们将所有类都塞进一个 Java 文件中。

### 5.2.1 非面向对象

你会注意到，（表达式类）像 Token 类一样，其中没有任何方法。这是一个很愚蠢的结构，巧妙的类型封装，但仅仅是一包数据。这在 Java 这样的面向对象语言中会有些奇怪，难道类不是应该*做一些事情*吗？

问题在于这些树类不属于任何单个的领域。树是在解析的时候创建的，难道类中应该有解析对应的方法？或者因为树结构在解释的时候被消费，其中是不是要提供解释相关的方法？树跨越了这些领域之间的边界，这意味着它们实际上不属于任何一方。

事实上，这些类型的存在是为了让解析器和解释器能够*进行交流*。这就适合于那些只是简单的数据而没有相关行为的类型。这种风格在 Lisp 和 ML 这样的函数式语言中是非常自然的，因为在这些语言中，*所有的*数据和行为都是分开的，但是在 Java 中感觉很奇怪。

函数式编程的爱好者们现在都跳起来惊呼：“看吧！面向对象的语言不适合作为解释器！”我不会那么过分的。您可能还记得，扫描器本身非常适合面向对象。它包含所有的可变状态来跟踪其在源代码中的位置、一组定义良好的公共方法和少量的私有辅助方法。

我的感觉是，在面向对象的风格下，解释器的每个阶段或部分都能正常工作。只不过在它们之间流动的数据结构剥离了行为。

### 5.2.2 节点树元编程

Java 可以表达无行为的类，但很难说它特别擅长。用 11 行代码在一个对象中填充 3 个字段是相当乏味的，当我们全部完成后，我们将有 21 个这样的类。

我不想浪费你的时间或我的墨水把这些都写下来。真的，每个子类的本质是什么?一个名称和一个字段列表而已。我们是聪明的语言黑客，对吧?我们把它自动化[^12]。

与其繁琐地手写每个类的定义、字段声明、构造函数和初始化器，我们一起编写一个脚本来完成任务。 它具有每种树类型（名称和字段）的描述，并打印出定义具有该名称和状态的类所需的 Java 代码。

该脚本是一个微型 Java 命令行应用程序，它生成一个名为“ Expr.java”的文件：

_<u>tool/GenerateAst.java，创建新文件</u>_

```java
package com.craftinginterpreters.tool;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.Arrays;
import java.util.List;

public class GenerateAst {
  public static void main(String[] args) throws IOException {
    if (args.length != 1) {
      System.err.println("Usage: generate_ast <output directory>");
      System.exit(64);
    }
    String outputDir = args[0];
  }
}
```

注意，这个文件在另一个包中，是`.tool`而不是`.lox`。这个脚本并不是解释器本身的一部分，它是一个工具，我们这种编写解释器的人，通过运行该脚本来生成语法树类。完成后，我们把“Expr.java”与实现中的其它文件进行相同的处理。我们只是自动化了文件的生成方式。

为了生成类，还需要对每种类型及其字段进行一些描述。

_<u>tool/GenerateAst.java，在 main()方法中添加</u>_

```java
    String outputDir = args[0];
    // 新增部分开始
    defineAst(outputDir, "Expr", Arrays.asList(
      "Binary   : Expr left, Token operator, Expr right",
      "Grouping : Expr expression",
      "Literal  : Object value",
      "Unary    : Token operator, Expr right"
    ));
    // 新增部分结束
  }
```

为简便起见，我将表达式类型的描述放入了字符串中。 每一项都包括类的名称，后跟`：`和以逗号分隔的字段列表。 每个字段都有一个类型和一个名称。

> The first thing `defineAst()` needs to do is output the base Expr class.

`defineAst()`需要做的第一件事是输出基类 Expr。

_<u>tool/GenerateAst.java，在 main()方法后添加：</u>_

```java
  private static void defineAst(
      String outputDir, String baseName, List<String> types)
      throws IOException {
    String path = outputDir + "/" + baseName + ".java";
    PrintWriter writer = new PrintWriter(path, "UTF-8");

    writer.println("package com.craftinginterpreters.lox;");
    writer.println();
    writer.println("import java.util.List;");
    writer.println();
    writer.println("abstract class " + baseName + " {");

    writer.println("}");
    writer.close();
  }
```

我们调用这个函数时，`baseName`是“Expr”，它既是类的名称，也是它输出的文件的名称。我们将它作为参数传递，而不是对名称进行硬编码，因为稍后我们将为语句添加一个单独的类族。

在基类内部，我们定义每个子类。

_<u>tool/GenerateAst.java，在 defineAst()类中添加[^13]：</u>_

```java
    writer.println("abstract class " + baseName + " {");
    // 新增部分开始
    // The AST classes.
    for (String type : types) {
      String className = type.split(":")[0].trim();
      String fields = type.split(":")[1].trim();
      defineType(writer, baseName, className, fields);
    }
    // 新增部分结束
    writer.println("}");
```

这段代码依次调用：

_<u>tool/GenerateAst.java，在 defineAst()后面添加：</u>_

```java
  private static void defineType(
      PrintWriter writer, String baseName,
      String className, String fieldList) {
    writer.println("  static class " + className + " extends " +
        baseName + " {");

    // Constructor.
    writer.println("    " + className + "(" + fieldList + ") {");

    // Store parameters in fields.
    String[] fields = fieldList.split(", ");
    for (String field : fields) {
      String name = field.split(" ")[1];
      writer.println("      this." + name + " = " + name + ";");
    }

    writer.println("    }");

    // Fields.
    writer.println();
    for (String field : fields) {
      writer.println("    final " + field + ";");
    }

    writer.println("  }");
  }
```

好了。所有的 Java 模板都完成了。它在类体中声明了每个字段。它为类定义了一个构造函数，为每个字段提供参数，并在类体中对其初始化。

现在编译并运行这个 Java 程序，它会生成一个新的“. Java”文件，其中包含几十行代码。那份文件还会变得更长[^14]。

## 5.3 处理树结构

先想象一下吧。尽管我们还没有到那一步，但请考虑一下解释器将如何处理语法树。Lox 中的每种表达式在运行时的行为都不一样。这意味着解释器需要选择不同的代码块来处理每种表达式类型。对于词法标记，我们可以简单地根据`TokenType`进行转换。但是我们并没有为语法树设置一个 "type "枚举，只是为每个语法树单独设置一个 Java 类。

我们可以编写一长串类型测试：

```java
if (expr instanceof Expr.Binary) {
  // ...
} else if (expr instanceof Expr.Grouping) {
  // ...
} else // ...
```

但所有这些顺序类型测试都很慢。类型名称按字母顺序排列在后面的表达式，执行起来会花费更多的时间，因为在找到正确的类型之前，它们会遇到更多的`if`情况。这不是我认为的优雅解决方案。

我们有一个类族，我们需要将一组行为与每个类关联起来。在 Java 这样的面向对象语言中，最自然的解决方案是将这些行为放入类本身的方法中。我们可以在 Expr 上添加一个抽象的`interpret()`方法，然后每个子类都要实现这个方法来解释自己[^15]。

这对于小型项目来说还行，但它的扩展性很差。就像我之前提到的，这些树类跨越了几个领域。至少，解析器和解释器都会对它们进行干扰。稍后您将看到，我们需要对它们进行名称解析。如果我们的语言是静态类型的，我们还需要做类型检查。

如果我们为每一个操作的表达式类中添加实例方法，就会将一堆不同的领域混在一起。这违反了[关注点分离原则](https://en.wikipedia.org/wiki/Separation_of_concerns)，并会产生难以维护的代码。

### 5.3.1 表达式问题

这个问题比起初看起来更基础。我们有一些类型，和一些高级操作，比如“解释”。对于每一对类型和操作，我们都需要一个特定的实现。画一个表:

![A table where rows are labeled with expression classes, and columns are function names.](./table.png)

行是类型，列是操作。每个单元格表示在该类型上实现该操作的唯一代码段。

像 Java 这样的面向对象的语言，假定一行中的所有代码都自然地挂在一起。它认为你对一个类型所做的所有事情都可能是相互关联的，而使用这类语言可以很容易将它们一起定义为同一个类里面的方法。

![The table split into rows for each class.](./rows.png)

这种情况下，向表中加入新行来扩展列表是很容易的，简单地定义一个新类即可，不需要修改现有的代码。但是，想象一下，如果你要添加一个新操作（新的一列）。在 Java 中，这意味着要拆开已有的那些类并向其中添加方法。

ML 家族中的函数式范型反过来了[^16]。在这些语言中，没有带方法的类，类型和函数是完全独立的。要为许多不同类型实现一个操作，只需定义一个函数。在该函数体中，您可以使用*模式匹配*（某种基于类型的 switch 操作）在同一个函数中实现每个类型对应的操作。

这使得添加新操作非常简单——只需定义另一个与所有类型模式匹配的的函数即可。

![The table split into columns for each function.](./columns.png)

但是，反过来说，添加新类型是困难的。您必须回头向已有函数中的所有模式匹配添加一个新的 case。
.

每种风格都有一定的 "纹路"。这就是范式名称的字面意思——面向对象的语言希望你按照类型的行来*组织*你的代码。而函数式语言则鼓励你把每一列的代码都归纳为一个*函数*。

一群聪明的语言迷注意到，这两种风格都不容易向表格中添加行和列。他们称这个困难为“表达式问题”[^17]。就像我们现在一样，他们是在试图找出在编译器中建模表达式语法树节点的最佳方法时，第一次遇到了该问题。

人们已经抛出了各种各样的语言特性、设计模式和编程技巧，试图解决这个问题，但还没有一种完美的语言能够解决它。与此同时，我们所能做的就是尽量选择一种与我们正在编写的程序的自然架构相匹配的语言。

面向对象在我们的解释器的许多部分都可以正常工作，但是这些树类与 Java 的本质背道而驰。 幸运的是，我们可以采用一种设计模式来解决这个问题。

### 5.3.2 访问者模式

**访问者模式**是所有*设计模式*中最容易被误解的模式，当您回顾过去几十年的软件架构泛滥状况时，会发现确实如此。

问题出在术语上。这个模式不是关于“visiting（访问）”，它的 “accept”方法也没有让人产生任何有用的想象。许多人认为这种模式与遍历树有关，但事实并非如此。我们确实要在一组树结构的类上使用它，但这只是一个巧合。如您所见，该模式在单个对象上也可以正常使用。

访问者模式实际上近似于 OOP 语言中的函数式。它让我们可以很容易地向表中添加新的列。我们可以在一个地方定义针对一组类型的新操作的所有行为，而不必触及类型本身。这与我们解决计算机科学中几乎所有问题的方式相同：添加中间层。

在将其应用到自动生成的 Expr 类之前，让我们先看一个更简单的例子。比方说我们有两种点心:Beignet(卷饼)和 Cruller(油酥卷)。

```java
 abstract class Pastry {
  }

  class Beignet extends Pastry {
  }

  class Cruller extends Pastry {
  }
```

我们希望能够定义新的糕点操作（烹饪，食用，装饰等），而不必每次都向每个类添加新方法。我们是这样做的。首先，我们定义一个单独的接口[^18]。

```java
  interface PastryVisitor {
    void visitBeignet(Beignet beignet);
    void visitCruller(Cruller cruller);
  }
```

可以对糕点执行的每个操作都是实现该接口的新类。 它对每种类型的糕点都有具体的方法。 这样一来，针对两种类型的操作代码都紧密地嵌套在一个类中。

给定一个糕点，我们如何根据其类型将其路由到访问者的正确方法？多态性拯救了我们！我们在 Pastry 中添加这个方法：

```java
  abstract class Pastry {
    abstract void accept(PastryVisitor visitor);
  }
```

每个子类都需要实现该方法：

```java
  class Beignet extends Pastry {
    @Override
    void accept(PastryVisitor visitor) {
      visitor.visitBeignet(this);
    }
  }
```

以及：

```java
  class Cruller extends Pastry {
    @Override
    void accept(PastryVisitor visitor) {
      visitor.visitCruller(this);
    }
  }
```

要对糕点执行一个操作，我们就调用它的`accept()`方法，并将我们要执行的操作 vistor 作为参数传入该方法。pastry 类——特定子类对`accept()`的重写实现——会反过来，在 visitor 上调用合适的 visit 方法，并将*自身*作为参数传入。

这就是这个技巧的核心所在。它让我们可以在*pastry*类上使用多态派遣，在*visitor*类上选择合适的方法。对应在表格中，每个 pastry 类都是一行，但如果你看一个 visitor 的所有方法，它们就会形成一*列*。

![Now all of the cells for one operation are part of the same class, the visitor.](./visitor.png)

我们为每个类添加了一个`accept（）`方法，我们可以根据需要将其用于任意数量的访问者，而无需再次修改*pastry*类。 这是一个聪明的模式。

### 5.3.3 表达式访问者

好的，让我们将它编入表达式类中。我们还要对这个模式进行一下完善。在糕点的例子中，visit 和`accept()`方法没有返回任何东西。在实践中，访问者通常希望定义能够产生值的操作。但`accept()`应该具有什么返回类型呢？我们不能假设每个访问者类都想产生相同的类型，所以我们将使用泛型来让每个实现类自行填充一个返回类型。

首先，我们定义访问者接口。同样，我们把它嵌套在基类中，以便将所有的内容都放在一个文件中。

_<u>tool/GenerateAst.java，在 defineAst()方法中添加：</u>_

```java
    writer.println("abstract class " + baseName + " {");
    // 新增部分开始
    defineVisitor(writer, baseName, types);
    // 新增部分结束
    // The AST classes.
```

这个函数会生成 visitor 接口。

_<u>tool/GenerateAst.java，在 defineAst()方法后添加：</u>_

```java
  private static void defineVisitor(
      PrintWriter writer, String baseName, List<String> types) {
    writer.println("  interface Visitor<R> {");

    for (String type : types) {
      String typeName = type.split(":")[0].trim();
      writer.println("    R visit" + typeName + baseName + "(" +
          typeName + " " + baseName.toLowerCase() + ");");
    }

    writer.println("  }");
  }
```

在这里，我们遍历所有的子类，并为每个子类声明一个 visit 方法。当我们以后定义新的表达式类型时，会自动包含这些内容。

在基类中，定义抽象 `accept()` 方法。

_<u>tool/GenerateAst.java，在 defineAst()方法中添加：</u>_

```java
    	defineType(writer, baseName, className, fields);
    }
    // 新增部分开始
    // The base accept() method.
    writer.println();
    writer.println("  abstract <R> R accept(Visitor<R> visitor);");
    // 新增部分结束
    writer.println("}");
```

最后，每个子类都实现该方法，并调用其类型对应的 visit 方法。

_<u>tool/GenerateAst.java，在 defineType()方法中添加：</u>_

```java
    writer.println("    }");
    // 新增部分开始
    // Visitor pattern.
    writer.println();
    writer.println("    @Override");
    writer.println("    <R> R accept(Visitor<R> visitor) {");
    writer.println("      return visitor.visit" +
        className + baseName + "(this);");
    writer.println("    }");
    // 新增部分结束
    // Fields.
```

这下好了。现在我们可以在表达式上定义操作，而且无需对类或生成器脚本进行修改。编译并运行这个生成器脚本，输出一个更新后的 "Expr.java "文件。该文件中包含一个生成的 Visitor 接口和一组使用该接口支持 Visitor 模式的表达式节点类。

在结束这杂乱的一章之前，我们先实现一下这个 Visitor 接口，看看这个模式的运行情况。

## 5.4 一个（不是很）漂亮的打印器

当我们调试解析器和解释器时，查看解析后的语法树并确保其与期望的结构一致通常是很有用的。我们可以在调试器中进行检查，但那可能有点难。

相反，我们需要一些代码，在给定语法树的情况下，生成一个明确的字符串表示。将语法树转换为字符串是解析器的逆向操作，当我们的目标是产生一个在源语言中语法有效的文本字符串时，通常被称为 "漂亮打印"。

这不是我们的目标。我们希望字符串非常明确地显示树的嵌套结构。如果我们要调试的是操作符的优先级是否处理正确，那么返回`1 + 2 * 3`的打印器并没有什么用，我们想知道`+`或`*`是否在语法树的顶部。

因此，我们生成的字符串表示形式不是 Lox 语法。相反，它看起来很像 Lisp。每个表达式都被显式地括起来，并且它的所有子表达式和词法标记都包含在其中。

给定一个语法树，如：

![An example syntax tree.](./expression.png)

输出结果为：

```js
(* (- 123) (group 45.67))
```

不是很“漂亮”，但是它确实明确地展示了嵌套和分组。为了实现这一点，我们定义了一个新类。

_<u>lox/AstPrinter.java，创建新文件：</u>_

```java
package com.craftinginterpreters.lox;

class AstPrinter implements Expr.Visitor<String> {
  String print(Expr expr) {
    return expr.accept(this);
  }
}
```

如你所见，它实现了 visitor 接口。这意味着我们需要为我们目前拥有的每一种表达式类型提供 visit 方法。

_<u>lox/AstPrinter.java，在 print()方法后添加：</u>_

```java
  return expr.accept(this);
  }
  // 新增部分开始
  @Override
  public String visitBinaryExpr(Expr.Binary expr) {
    return parenthesize(expr.operator.lexeme,
                        expr.left, expr.right);
  }

  @Override
  public String visitGroupingExpr(Expr.Grouping expr) {
    return parenthesize("group", expr.expression);
  }

  @Override
  public String visitLiteralExpr(Expr.Literal expr) {
    if (expr.value == null) return "nil";
    return expr.value.toString();
  }

  @Override
  public String visitUnaryExpr(Expr.Unary expr) {
    return parenthesize(expr.operator.lexeme, expr.right);
  }
	// 新增部分结束
}
```

字面量表达式很简单——它们将值转换为一个字符串，并通过一个小检查用 Java 中的`null`代替 Lox 中的`nil`。其他表达式有子表达式，所以它们要使用`parenthesize()`这个辅助方法：

_<u>lox/AstPrinter.java，在 visitUnaryExpr()方法后添加：</u>_

```java
  private String parenthesize(String name, Expr... exprs) {
    StringBuilder builder = new StringBuilder();

    builder.append("(").append(name);
    for (Expr expr : exprs) {
      builder.append(" ");
      builder.append(expr.accept(this));
    }
    builder.append(")");

    return builder.toString();
  }
```

它接收一个名称和一组子表达式作为参数，将它们全部包装在圆括号中，并生成一个如下的字符串：

```
(+ 1 2)
```

请注意，它在每个子表达式上调用`accept()`并将自身传递进去。 这是递归步骤，可让我们打印整棵树。

我们还没有解析器，所以很难看到它的实际应用。现在，我们先使用一个`main()`方法来手动实例化一个树并打印它。

_<u>lox/AstPrinter.java，在 parenthesize()方法后添加：</u>_

```java
  public static void main(String[] args) {
    Expr expression = new Expr.Binary(
        new Expr.Unary(
            new Token(TokenType.MINUS, "-", null, 1),
            new Expr.Literal(123)),
        new Token(TokenType.STAR, "*", null, 1),
        new Expr.Grouping(
            new Expr.Literal(45.67)));

    System.out.println(new AstPrinter().print(expression));
  }
```

如果我们都做对了，它就会打印：

```js
(* (- 123) (group 45.67))
```

您可以继续删除这个方法，我们后面不再需要它了。另外，当我们添加新的语法树类型时，我不会在 AstPrinter 中展示它们对应的 visit 方法。如果你想这样做(并且希望 Java 编译器不会报错)，那么你可以自行添加这些方法。在下一章，当我们开始将 Lox 代码解析为语法树时，它将会派上用场。或者，如果你不想维护 AstPrinter，可以随意删除它。我们不再需要它了。

[^1]: 我非常担心这一章会成为这本书中最无聊的章节之一，所以我尽可能多地往里面塞入了很多有趣的想法。
[^2]: 在美国，运算符优先级常缩写为**PEMDAS**，分别表示*P*arentheses(括号), *E*xponents(指数), *M*ultiplication/*D*ivision(乘除), *A*ddition/*S*ubtraction(加减)。为了便于记忆，将缩写词扩充为“**Please Excuse My Dear Aunt Sally**”。
[^3]: 这并不是说树是我们代码的唯一可能的表示方式。在第三部分，我们将生成字节码，这是另一种对人类不友好但更接近机器的表示方式。
[^4]: 将头部限制为单个符号是上下文无关语法的定义特性。更强大的形式，如[无限制文法](https://en.wikipedia.org/wiki/Unrestricted_grammar)，允许在头部和主体中都包含一系列的符号。
[^5]: 是的，我们需要为定义语法的规则定义一个语法。我们也应该指定这个元语法吗?我们用什么符号来表示它?从上到下都是语言
[^6]: 想象一下，我们在这里递归扩展几次`breakfast`规则，比如 "bacon with bacon with bacon with . . ." ，为了正确地完成这个字符串，我们需要在结尾处添加同等数量的 "on the side "词组。跟踪所需尾部的数量超出了正则语法的能力范围。正则语法可以表达*重复*，但它们无法*统计*有多少重复，但是这（种跟踪）对于确保字符串的`with`和`on the side`部分的数量相同是必要的。
[^7]: Scheme 编程语言就是这样工作的。它根本没有内置的循环功能。相反，所有重复都用递归来表示。
[^8]: 如果你愿意，可以尝试使用这个语法生成一些表达式，就像我们之前用早餐语法做的那样。生成的表达式你觉得对吗？你能让它生成任何错误的东西，比如 1+/3 吗？
[^9]: 特别是，我们要定义一个**抽象语法树（AST）**。在**解析树**中，每一个语法生成式都成为树中的一个节点。AST 省略了后面阶段不需要的生成式。
[^10]: 词法单元也不是完全同质的。字面值的标记存储值，但其他类型的词素不需要该状态。我曾经见过一些扫描器使用不同的类来处理字面量和其他类型的词素，但我认为我应该把事情简单化。
[^11]: 我尽量避免在代码中使用缩写，因为这会让不知道其含义的读者犯错误。但是在我所研究过的编译器中，“Expr”和“Stmt”是如此普遍，我最好现在就开始让您习惯它们。
[^12]: 我从 Jython 和 IronPython 的创建者 Jim Hugunin 那里得到了编写语法树类脚本的想法。真正的脚本语言比 Java 更适合这种情况，但我尽量不向您提供太多的语言。
[^13]: 这不是世界上最优雅的字符串操作代码，但也很好。它只在我们给它的类定义集上运行。稳健性不是优先考虑的问题。
[^14]: 附录 II 包含了在我们完成 jlox 的实现并定义了它的所有语法树节点之后，这个脚本生成的代码。
[^15]: 这就是 Erich Gamma 等人在《设计模式:可重用的面向对象软件的元素》一书中所谓的[解释器模式](https://en.wikipedia.org/wiki/Interpreter_pattern)。
[^16]: ML，是元语言(metalanguage)的简称，它是由 Robin Milner 和他的朋友们创建的，是伟大的编程语言家族的主要分支之一。它的子程序包括 SML、Caml、OCaml、Haskell 和 F#。甚至 Scala、Rust 和 Swift 都有很强的相似性。就像 Lisp 一样，它也是那种充满了好点子的语言之一，即使在 40 多年后的今天，语言设计者仍然在重新发现它们。
[^17]: 诸如 Common Lisp 的 CLOS，Dylan 和 Julia 这样的支持多方法(多分派)的语言都能轻松添加新类型和操作。它们通常牺牲的是静态类型检查或单独编译。
[^18]: 在设计模式中，这两种方法的名字都叫`visit()`，很容易混淆，需要依赖重载来区分不同方法。这也导致一些读者认为正确的 visit 方法是在运行时根据其参数类型选择的。事实并非如此。与重写不同，重载是在编译时静态分派的。为每个方法使用不同的名称使分派更加明显，同时还向您展示了如何在不支持重载的语言中应用此模式。

---

## 习题

1、之前我说过，我们在语法元语法中添加的`|`、`*`、`+`等形式只是语法糖。以这个语法为例:

```
expr → expr ( "(" ( expr ( "," expr )* )? ")" | "." IDENTIFIER )+
     | IDENTIFIER
     | NUMBER
```

生成一个与同一语言相匹配的语法，但不要使用任何语法糖。

附加题：这一点语法表示了什么样的表达式？

2、Visitor 模式让你可以在面向对象的语言中模仿函数式。为函数式语言设计一个互补的模式，该模式让你可以将一个类型上的所有操作捆绑在一起，并轻松扩展新的类型。

(SML 或 Haskell 是这个练习的理想选择，但 Scheme 或其它 Lisp 方言也可以。)

3、在[逆波兰表达式](https://en.wikipedia.org/wiki/Reverse_Polish_notation)(RPN)中，算术运算符的操作数都放在运算符之前，所以`1 + 2`变成了`1 2 +`。计算时从左到右进行，操作数被压入隐式栈。算术运算符弹出前两个数字，执行运算，并将结果推入栈中。因此,

```java
(1 + 2) * (4 - 3)
```

在 RPN 中变为了

```
1 2 + 4 3 - *
```

为我们的语法树类定义一个 Vistor 类，该类接受一个表达式，将其转换为 RPN，并返回结果字符串。
