---
title: 扫描
description: Scanning
---

> 大干特工。每件值得做的事都要尽力做好。
>
> ​ —— Robert A. Heinlein, _Time Enough for Love_

任何编译器或解释器的第一步都是扫描[^1]。扫描器以一系列字符的形式接收原始源代码，并将其分组成一系列的块，我们称之为**标识**（词法单元）。这些是有意义的 "单词 "和 "标点"，它们构成了语言的语法。

对于我们来说，扫描也是一个很好的起点，因为代码不是很难——相当于有很多分支的`switch`语句。这可以帮助我们在学习更后面有趣的部分之前进行热身。在本章结束时，我们将拥有一个功能齐全、速度快的扫描器，它可以接收任何一串 Lox 源代码，并产生标记，我们将在下一章把这些标记输入到解析器中。

## 4.1 解释器框架

由于这是我们的第一个真正的章节，在我们开始实际扫描代码之前，我们需要先勾勒出我们的解释器 jlox 的基本形态。在 Java 中，一切都是从一个类开始的。

【译者注：原作者在代码的侧边栏标注了代码名及对应的操作（创建文件、追加代码、删除代码等），由于翻译版的格式受限，将这部分信息迁移到代码块之前，以带下划线的斜体突出，后同】

<u>_lox/Lox.java，创建新文件[^2]_</u>

```java
package com.craftinginterpreters.lox;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public class Lox {
  public static void main(String[] args) throws IOException {
    if (args.length > 1) {
      System.out.println("Usage: jlox [script]");
      System.exit(64);
    } else if (args.length == 1) {
      runFile(args[0]);
    } else {
      runPrompt();
    }
  }
}
```

把它贴在一个文本文件里，然后去把你的 IDE 或者 Makefile 或者其他工具设置好。我就在这里等你准备好。好了吗？好的！

Lox 是一种脚本语言，这意味着它直接从源代码执行。我们的解释器支持两种运行代码的方式。如果从命令行启动 jlox 并为其提供文件路径，它将读取该文件并执行。

_<u>lox/Lox.java，添加到`main()`方法之后</u>_

```java
private static void runFile(String path) throws IOException {
  byte[] bytes = Files.readAllBytes(Paths.get(path));
  run(new String(bytes, Charset.defaultCharset()));
}
```

如果你想与你的解释器对话, 可以交互式的启动它。 启动的时候不加任何参数就可以了，它会有一个提示符，你可以在提示符处一次输入并执行一行代码。

_<u>lox/Lox.java，添加到`runFile()`方法之后[^3]</u>_

```java
private static void runPrompt() throws IOException {
  InputStreamReader input = new InputStreamReader(System.in);
  BufferedReader reader = new BufferedReader(input);

  for (;;) {
    System.out.print("> ");
    String line = reader.readLine();
    if (line == null) break;
    run(line);
  }
}
```

`readLine()`函数，顾名思义，读取用户在命令行上的一行输入，并返回结果。要终止交互式命令行应用程序，通常需要输入 Control-D。这样做会向程序发出 "文件结束" 的信号。当这种情况发生时，readLine()就会返回 null，所以我们检查一下是否存在 null 以退出循环。

交互式提示符和文件运行工具都是对这个核心函数的简单包装：

_<u>lox/Lox.java，添加到`runPrompt()`之后</u>_

```java
  private static void run(String source) {
    Scanner scanner = new Scanner(source);
    List<Token> tokens = scanner.scanTokens();

    // For now, just print the tokens.
    for (Token token : tokens) {
      System.out.println(token);
    }
  }
```

因为我们还没有写出解释器，所以这些代码还不是很有用，但这只是小步骤，你要明白？现在，它可以打印出我们即将完成的扫描器所返回的标记，这样我们就可以看到我们的解析是否生效。

### 4.1.1 错误处理

当我们设置东西的时候，另一个关键的基础设施是错误处理。教科书有时会掩盖这一点，因为这更多的是一个实际问题，而不是一个正式的计算机科学问题。但是，如果你关心的是如何制作一个真正可用的语言，那么优雅地处理错误是至关重要的。

我们的语言提供的处理错误的工具构成了其用户界面的很大一部分。当用户的代码在工作时，他们根本不会考虑我们的语言——他们的脑子里都是他们的程序。通常只有当程序出现问题时，他们才会注意到我们的实现。

当这种情况发生时，我们就需要向用户提供他们所需要的所有信息，让他们了解哪里出了问题，并引导他们慢慢达到他们想要去的地方。要做好这一点，意味着从现在开始，在解释器的整个实现过程中都要考虑错误处理[^4]。

_<u>lox/Lox.java，添加到`run()`方法之后</u>_

```java
static void error(int line, String message) {
    report(line, "", message);
  }

  private static void report(int line, String where,
                             String message) {
    System.err.println(
        "[line " + line + "] Error" + where + ": " + message);
    hadError = true;
  }
```

这个`error()`函数和其工具方法`report()`会告诉用户在某一行上发生了一些语法错误。这其实是最起码的，可以说你有错误报告功能。想象一下，如果你在某个函数调用中不小心留下了一个悬空的逗号，解释器就会打印出来：

```java
Error: Unexpected "," somewhere in your code. Good luck finding it!
```

这种信息没有多大帮助。我们至少要给他们指出正确的方向。好一些的做法是指出开头和结尾一栏，这样他们就知道这一行的位置了。更好的做法是向用户显示违规的行，比如：

```java
Error: Unexpected "," in argument list.

    15 | function(first, second,);
                               ^-- Here.
```

我很想在这本书里实现这样的东西，但老实说，这会引入很多繁琐的字符串操作代码。这些代码对用户来说非常有用，但在书中读起来并不友好，而且技术上也不是很有趣。所以我们还是只用一个行号。在你们自己的解释器中，请按我说的做，而不是按我做的做。

我们在 Lox 主类中坚持使用这个错误报告功能的主要原因就是因为那个 hadError 字段。它的定义在这里：

_<u>lox/Lox.java 在 Lox 类中添加：</u>_

```java
public class Lox {
  static boolean hadError = false;
```

我们将以此来确保我们不会尝试执行有已知错误的代码。此外，它还能让我们像一个好的命令行工具那样，用一个非零的结束代码退出。

_<u>lox/Lox.java，在 runFile()中添加：</u>_

```java
    run(new String(bytes, Charset.defaultCharset()));

    // Indicate an error in the exit code.
    if (hadError) System.exit(65);
  }
```

我们需要在交互式循环中重置此标志。 如果用户输入有误，也不应终止整个会话。

_<u>lox/Lox.java，在 runPrompt()中添加：</u>_

```java
      run(line);
      hadError = false;
    }
```

我把错误报告拉出来，而不是把它塞进扫描器和其他可能发生错误的阶段，还有另一个原因，是为了提醒您，把产生错误的代码和报告错误的代码分开是一个很好的工程实践。

前端的各个阶段都会检测到错误，但是它们不需要知道如何向用户展示错误。在一个功能齐全的语言实现中，可能有多种方式展示错误信息：在 stderr，在 IDE 的错误窗口中，记录到文件，等等。您肯定不希望扫描器和解释器中到处充斥着这类代码。

理想情况下，我们应该有一个实际的抽象，即传递给扫描程序和解析器的某种 ErrorReporter 接口[^5]，这样我们就可以交换不同的报告策略。对于我们这里的简单解释器，我没有那样做，但我至少将错误报告代码移到了一个不同的类中。

有了一些基本的错误处理，我们的应用程序外壳已经准备好了。一旦我们有了一个带有 `scanTokens() `方法的 Scanner 类，我们就可以开始运行它了。在我们开始之前，让我们更精确地了解什么是标记（tokens）。

## 4.2 词素和标记（词法单元）

下面是一行 lox 代码：

```js
var language = "lox";
```

在这里，`var`是声明变量的关键字。“v-a-r”这三个字符的序列是有意义的。但如果我们从`language`中间抽出三个字母，比如“g-u-a”，它们本身并没有任何意义。

这就是词法分析的意义所在。我们的工作是扫描字符列表，并将它们归纳为具有某些含义的最小序列。每一组字符都被称为词素。在示例代码行中，词素是：

!['var', 'language', '=', 'lox', ';'](./lexemes.png)

词素只是源代码的原始子字符串。 但是，在将字符序列分组为词素的过程中，我们也会发现了一些其他有用的信息。 当我们获取词素并将其与其他数据捆绑在一起时，结果是一个标记（token，词法单元）。它包含一些有用的内容，比如：

### 4.2.1 标记类型

关键词是语言语法的一部分，所以解析器经常会有这样的代码："如果下一个标记是`while`，那么就……" 。这意味着解析器想知道的不仅仅是它有某个标识符的词素，而是它得到一个*保留词*，以及它是*哪个*关键词。

解析器可以通过比较字符串对原始词素中的标记进行分类，但这样做很慢，而且有点难看[^6]。相反，在我们识别一个词素的时候，我们还要记住它代表的是哪种词素。我们为每个关键字、操作符、标点位和字面量都有不同的类型。

_<u>lox/TokenType.java 创建新文件</u>_

```java
package com.craftinginterpreters.lox;

enum TokenType {
  // Single-character tokens.
  LEFT_PAREN, RIGHT_PAREN, LEFT_BRACE, RIGHT_BRACE,
  COMMA, DOT, MINUS, PLUS, SEMICOLON, SLASH, STAR,

  // One or two character tokens.
  BANG, BANG_EQUAL,
  EQUAL, EQUAL_EQUAL,
  GREATER, GREATER_EQUAL,
  LESS, LESS_EQUAL,

  // Literals.
  IDENTIFIER, STRING, NUMBER,

  // Keywords.
  AND, CLASS, ELSE, FALSE, FUN, FOR, IF, NIL, OR,
  PRINT, RETURN, SUPER, THIS, TRUE, VAR, WHILE,

  EOF
}
```

### 4.2.2 字面量

字面量有对应词素——数字和字符串等。由于扫描器必须遍历文字中的每个字符才能正确识别，所以它还可以将值的文本表示转换为运行时对象，解释器后续将使用该对象。

### 4.2.3 位置信息

早在我宣讲错误处理的福音时，我们就看到，我们需要告诉用户错误发生在哪里。（用户）从这里开始定位问题。在我们的简易解释器中，我们只说明了标记出现在哪一行上，但更复杂的实现中还应该包括列位置和长度[^7]。

我们将所有这些数据打包到一个类中。

_<u>lox/Token.java，创建新文件</u>_

```java
package com.craftinginterpreters.lox;

class Token {
  final TokenType type;
  final String lexeme;
  final Object literal;
  final int line;

  Token(TokenType type, String lexeme, Object literal, int line) {
    this.type = type;
    this.lexeme = lexeme;
    this.literal = literal;
    this.line = line;
  }

  public String toString() {
    return type + " " + lexeme + " " + literal;
  }
}
```

现在我们有了一个信息充分的对象，足以支撑解释器的所有后期阶段。

## 4.3 正则语言和表达式

既然我们已知道我们要输出什么，那么，我们就开始吧。扫描器的核心是一个循环。从源码的第一个字符开始，扫描器计算出该字符属于哪个词素，并消费它和属于该词素的任何后续字符。当到达该词素的末尾时，扫描器会输出一个标记（词法单元 token）。

然后再循环一次，它又循环回来，从源代码中的下一个字符开始再做一次。它一直这样做，吃掉字符，偶尔，呃，排出标记，直到它到达输入的终点。

![An alligator eating characters and, well, you don't want to know.](./lexigator.png)

在循环中，我们会查看一些字符，以确定它 "匹配 "的是哪种词素，这部分内容可能听起来很熟悉，但如果你知道正则表达式，你可以考虑为每一种词素定义一个 regex，并使用这些 regex 来匹配字符。例如，Lox 对标识符（变量名等）的规则与 C 语言相同。下面的 regex 可以匹配一个标识符：

```js
[a-zA-Z_][a-zA-Z_0-9]*
```

如果你确实想到了正则表达式，那么你的直觉还是很深刻的。决定一门语言如何将字符分组为词素的规则被称为它的**词法语法**[^8]。在 Lox 中，和大多数编程语言一样，该语法的规则非常简单，可以将其归为 **[正则语言](https://en.wikipedia.org/wiki/Regular_language)**。这里的正则和正则表达式中的 "正则 "是一样的含义。

如果你愿意，你可以非常精确地使用正则表达式来识别 Lox 的所有不同词组，而且还有一堆有趣的理论来支撑着为什么会这样以及它的意义。像[Lex](http://dinosaur.compilertools.net/lex/)[^9]或[Flex](https://github.com/westes/flex)这样的工具就是专门为实现这一功能而设计的——向其中传入一些正则表达式，它可以为您提供完整的扫描器。

由于我们的目标是了解扫描器是如何工作的，所以我们不会把这个任务交给正则表达式。我们要亲自动手实现。

## 4.4 Scanner 类

事不宜迟，我们先来建一个扫描器吧。

_<u>lox/Scanner.java，创建新文件[^10]</u>_

```java
package com.craftinginterpreters.lox;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.craftinginterpreters.lox.TokenType.*;

class Scanner {
  private final String source;
  private final List<Token> tokens = new ArrayList<>();

  Scanner(String source) {
    this.source = source;
  }
}
```

我们将原始的源代码存储为一个简单的字符串，并且我们已经准备了一个列表来保存扫描时产生的标记。前面提到的循环看起来类似于：

_<u>lox/Scanner.java，方法 Scanner()后添加</u>_：

```java
  List<Token> scanTokens() {
    while (!isAtEnd()) {
      // We are at the beginning of the next lexeme.
      start = current;
      scanToken();
    }

    tokens.add(new Token(EOF, "", null, line));
    return tokens;
  }
```

扫描器通过自己的方式遍历源代码，添加标记，直到遍历完所有字符。然后，它在最后附加一个的 "end of file "标记。严格意义上来说，这并不是必须的，但它可以使我们的解析器更加干净。

这个循环依赖于几个字段来跟踪扫描器在源代码中的位置。

_<u>lox/Scanner.java，在 Scanner 类中添加：</u>_

```java
  private final List<Token> tokens = new ArrayList<>();
// 添加下面三行代码
  private int start = 0;
  private int current = 0;
  private int line = 1;

  Scanner(String source) {
```

`start`和`current`字段是指向字符串的偏移量。`start`字段指向被扫描的词素中的第一个字符，`current`字段指向当前正在处理的字符。`line`字段跟踪的是`current`所在的源文件行数，这样我们产生的标记就可以知道其位置。

然后，我们还有一个辅助函数，用来告诉我们是否已消费完所有字符。

_<u>lox/Scanner.java 在 scanTokens()方法之后添加：</u>_

```java
  private boolean isAtEnd() {
    return current >= source.length();
  }
```

## 4 . 5 识别词素

在每一次循环中，我们可以扫描出一个 token。这是扫描器真正的核心。让我们先从简单情况开始。想象一下，如果每个词素只有一个字符长。您所需要做的就是消费下一个字符并为其选择一个 token 类型。在 Lox 中有一些词素只包含一个字符，所以我们从这些词素开始[^11]。

_<u>lox/Scanner.java 添加到 scanTokens()方法之后</u>_

```java
private void scanToken() {
    char c = advance();
    switch (c) {
      case '(': addToken(LEFT_PAREN); break;
      case ')': addToken(RIGHT_PAREN); break;
      case '{': addToken(LEFT_BRACE); break;
      case '}': addToken(RIGHT_BRACE); break;
      case ',': addToken(COMMA); break;
      case '.': addToken(DOT); break;
      case '-': addToken(MINUS); break;
      case '+': addToken(PLUS); break;
      case ';': addToken(SEMICOLON); break;
      case '*': addToken(STAR); break;
    }
  }
```

同样，我们也需要一些辅助方法。

_<u>lox/Scanner.java，添加到 isAtEnd()方法后</u>_

```java
  private char advance() {
    current++;
    return source.charAt(current - 1);
  }

  private void addToken(TokenType type) {
    addToken(type, null);
  }

  private void addToken(TokenType type, Object literal) {
    String text = source.substring(start, current);
    tokens.add(new Token(type, text, literal, line));
  }
```

`advance()`方法获取源文件中的下一个字符并返回它。`advance()`用于处理输入，`addToken()`则用于输出。该方法获取当前词素的文本并为其创建一个新 token。我们马上会使用另一个重载方法来处理带有字面值的 token。

### 4.5.1 词法错误

在我们深入探讨之前，我们先花一点时间考虑一下词法层面的错误。如果用户抛入解释器的源文件中包含一些 Lox 中不使用的字符——如`@#^`，会发生什么？现在，这些字符被默默抛弃了。它们没有被 Lox 语言使用，但是不意味着解释器可以假装它们不存在。相反，我们应该报告一个错误：

_<u>lox/Scanner.java 在 scanToken()方法中添加：</u>_

```java
      case '*': addToken(STAR); break;

      default:
        Lox.error(line, "Unexpected character.");
        break;
    }
```

注意，错误的字符仍然会被前面调用的`advance()`方法消费。这一点很重要，这样我们就不会陷入无限循环了。

另请注意，我们一直在扫描。 程序稍后可能还会出现其他错误。 如果我们能够一次检测出尽可能多的错误，将为我们的用户带来更好的体验。 否则，他们会看到一个小错误并修复它，但是却出现下一个错误，不断重复这个过程。语法错误“打地鼠”一点也不好玩。

(别担心。因为`hadError`进行了赋值，我们永远不会尝试执行任何代码，即使程序在继续运行并扫描代码文件的其余部分。)

### 4.5.2 操作

我们的单字符词素已经生效了，但是这不能涵盖 Lox 中的所有操作符。比如`!`，这是单字符，对吧？有时候是的，但是如果下一个字符是等号，那么我们应该改用`!=` 词素。注意，这里的`!`和`=`*不是*两个独立的操作符。在 Lox 中，你不能写`! =`来表示不等操作符。这就是为什么我们需要将`!=`作为单个词素进行扫描。同样地，`<`、`>`和`=`都可以与后面跟随的`=`来组合成其他相等和比较操作符。

对于所有这些情况，我们都需要查看第二个字符。

_<u>lox/Scanner.java，在 scanToken()方法中添加</u>_

```java
      case '*': addToken(STAR); break;
      case '!':
        addToken(match('=') ? BANG_EQUAL : BANG);
        break;
      case '=':
        addToken(match('=') ? EQUAL_EQUAL : EQUAL);
        break;
      case '<':
        addToken(match('=') ? LESS_EQUAL : LESS);
        break;
      case '>':
        addToken(match('=') ? GREATER_EQUAL : GREATER);
        break;
      default:
```

这些分支中使用了下面的新方法：

_<u>lox/Scanner.java 添加到 scanToken()方法后</u>_

```java
  private boolean match(char expected) {
    if (isAtEnd()) return false;
    if (source.charAt(current) != expected) return false;

    current++;
    return true;
  }
```

这就像一个有条件的`advance()`。只有当前字符是我们正在寻找的字符时，我们才会消费。

使用`match()`，我们分两个阶段识别这些词素。例如，当我们得到`!`时，我们会跳转到它的 case 分支。这意味着我们知道这个词素是以 `!`开始的。然后，我们查看下一个字符，以确认词素是一个 `!=` 还是仅仅是一个 `!`。

## 4.6 更长的词素

我们还缺少一个操作符：表示除法的`/`。这个字符需要一些特殊处理，因为注释也是以斜线开头的。

_<u>lox/Scanner.java，在 scanToken()方法中添加：</u>_

```java
      break;
      case '/':
        if (match('/')) {
          // A comment goes until the end of the line.
          while (peek() != '\n' && !isAtEnd()) advance();
        } else {
          addToken(SLASH);
        }
        break;
      default:
```

这与其它的双字符操作符是类似的，区别在于我们找到第二个`/`时，还没有结束本次标记。相反，我们会继续消费字符直至行尾。

这是我们处理较长词素的一般策略。当我们检测到一个词素的开头后，我们会分流到一些特定于该词素的代码，这些代码会不断地消费字符，直到结尾。

我们又有了一个辅助函数：

_<u>lox/Scanner.java，在 match()方法后添加：</u>_

```java
  private char peek() {
    if (isAtEnd()) return '\0';
    return source.charAt(current);
  }
```

这有点像`advance()`方法，只是不会消费字符。这就是所谓的**lookahead(前瞻)**[^12]。因为它只关注当前未消费的字符，所以我们有*一个前瞻字符*。一般来说，前瞻的字符越少，扫描器运行速度就越快。词法语法的规则决定了我们需要前瞻多少字符。幸运的是，大多数广泛使用的语言只需要提前一到两个字符。

注释是词素，但是它们没有含义，而且解析器也不想要处理它们。所以，我们达到注释末尾后，*不会*调用`addToken()`方法。当我们循环处理下一个词素时，`start`已经被重置了，注释的词素就消失在一阵烟雾中了。

既然如此，现在正好可以跳过其它那些无意义的字符了：换行和空格。

_<u>lox/Scanner.java，在 scanToken()方法中添加：</u>_

```java
      	break;
      case ' ':
      case '\r':
      case '\t':
        // Ignore whitespace.
        break;

      case '\n':
        line++;
        break;
      default:
        Lox.error(line, "Unexpected character.");
```

当遇到空白字符时，我们只需回到扫描循环的开头。这样就会在空白字符之后开始一个新的词素。对于换行符，我们做同样的事情，但我们也会递增行计数器。(这就是为什么我们使用`peek()` 而不是`match()`来查找注释结尾的换行符。我们到这里希望能读取到换行符，这样我们就可以更新行数了)

我们的扫描器越来越聪明了。它可以处理相当自由形式的代码，如：

```java
// this is a comment
(( )){} // grouping stuff
!*+-/=<> <= == // operators
```

### 4.6.1 字符串字面量

现在我们对长词素已经很熟悉了，我们可以开始处理字面量了。我们先处理字符串，因为字符串总是以一个特定的字符`"`开头。

_<u>lox/Scanner.java，在 scanToken()方法中添加：</u>_

```java
      	break;
      case '"': string(); break;
      default:
```

这里会调用：

_lox/Scanner.java_，在 _scanToken_()方法之后添加：

```java
  private void string() {
    while (peek() != '"' && !isAtEnd()) {
      if (peek() == '\n') line++;
      advance();
    }

    if (isAtEnd()) {
      Lox.error(line, "Unterminated string.");
      return;
    }

    // The closing ".
    advance();

    // Trim the surrounding quotes.
    String value = source.substring(start + 1, current - 1);
    addToken(STRING, value);
  }
```

与注释类似，我们会一直消费字符，直到`"`结束该字符串。如果输入内容耗尽，我们也会进行优雅的处理，并报告一个对应的错误。

没有特别的原因，Lox 支持多行字符串。这有利有弊，但禁止换行比允许换行更复杂一些，所以我把它们保留了下来。这意味着当我们在字符串内遇到新行时，我们也需要更新`line`值。

最后，还有一个有趣的地方就是当我们创建标记时，我们也会产生实际的字符串值，该值稍后将被解释器使用。这里，值的转换只需要调用`substring()`剥离前后的引号。如果 Lox 支持转义序列，比如`\n`，我们会在这里取消转义。

### 4.6.2 数字字面量

在 Lox 中，所有的数字在运行时都是浮点数，但是同时支持整数和小数字面量。一个数字字面量就是一系列数位，后面可以跟一个`.`和一或多个尾数[^13]。

```java
1234
12.34
```

我们不允许小数点处于最开始或最末尾，所以下面的格式是不正确的：

```java
.1234
1234.
```

我们可以很容易地支持前者，但为了保持简单，我把它删掉了。如果我们要允许对数字进行方法调用，比如`123.sqrt()`，后者会变得很奇怪。

为了识别数字词素的开头，我们会寻找任何一位数字。 为每个十进制数字添加 case 分支有点乏味，所以我们直接在默认分支中进行处理。

_<u>lox/Scanner.java，在 scanToken()方法中替换一行：</u>_

```java
      default:
      	// 替换部分开始
      	if (isDigit(c)) {
          number();
        } else {
          Lox.error(line, "Unexpected character.");
        }
        // 替换部分结束
        break;
```

这里依赖下面的小工具函数[^14]：

_<u>lox/Scanner.java，在 peek()方法之后添加：</u>_

```java
  private boolean isDigit(char c) {
    return c >= '0' && c <= '9';
  }
```

一旦我们知道当前在处理数字，我们就分支进入一个单独的方法消费剩余的字面量，跟字符串的处理类似。

_<u>lox/Scanner.java，在 scanToken()方法后添加：</u>_

```java
  private void number() {
    while (isDigit(peek())) advance();

    // Look for a fractional part.
    if (peek() == '.' && isDigit(peekNext())) {
      // Consume the "."
      advance();

      while (isDigit(peek())) advance();
    }

    addToken(NUMBER,
        Double.parseDouble(source.substring(start, current)));
  }
```

我们在字面量的整数部分中尽可能多地获取数字。然后我们寻找小数部分，也就是一个小数点(`.`)后面至少跟一个数字。如果确实有小数部分，同样地，我们也尽可能多地获取数字。

在定位到小数点之后需要继续前瞻第二个字符，因为我们只有确认其*后*有数字才会消费`.`。所以我们添加了[^15]：

_<u>lox/Scanner.java，在 peek()方法后添加</u>_

```java
  private char peekNext() {
    if (current + 1 >= source.length()) return '\0';
    return source.charAt(current + 1);
  }
```

最后，我们将词素转换为其对应的数值。我们的解释器使用 Java 的`Double`类型来表示数字，所以我们创建一个该类型的值。我们使用 Java 自带的解析方法将词素转换为真正的 Java double。我们可以自己实现，但是，说实话，除非你想为即将到来的编程面试做准备，否则不值得你花时间。

剩下的词素是 Boolean 和`nil`，但我们把它们作为关键字来处理，这样我们就来到了......

## 4.7 保留字和标识符

我们的扫描器基本完成了，词法语法中还需要实现的部分仅剩标识符及其近亲——保留字。你也许会想，我们可以采用与处理`<=`等多字符操作符时相同的方法来匹配关键字，如`or`。

```java
case 'o':
  if (peek() == 'r') {
    addToken(OR);
  }
  break;
```

考虑一下，如果用户将变量命名为`orchid`会发生什么？扫描器会先看到前面的两个字符，然后立刻生成一个`or`标记。这就涉及到了一个重要原则，叫作**maximal munch**(最长匹配)[^16]。当两个语法规则都能匹配扫描器正在处理的一大块代码时，_哪个规则相匹配的字符最多，就使用哪个规则_。

该规则规定，如果我们可以将`orchid`匹配为一个标识符，也可以将`or`匹配为一个关键字，那就采用第一种结果。这也就是为什么我们在前面会默认为，`<=`应该识别为单一的`<=`标记，而不是`<`后面跟了一个`=`。

最大匹配原则意味着，我们只有扫描完一个可能是标识符的片段，才能确认是否一个保留字。毕竟，保留字也是一个标识符，只是一个已经被语言要求为自己所用的标识符。这也是**保留字**一词的由来。

所以我们首先假设任何以字母或下划线开头的词素都是一个标识符。

_<u>lox/Scanner.java，在 scanToken()中添加代码</u>_

```java
        default:
        if (isDigit(c)) {
          number();
          // 新增部分开始
        } else if (isAlpha(c)) {
          identifier();
        // 新增部分结束
        } else {
          Lox.error(line, "Unexpected character.");
        }
```

其它代码如下：

_<u>lox/Scanner.java，在 scanToken()方法之后添加：</u>_

```java
  private void identifier() {
    while (isAlphaNumeric(peek())) advance();

    addToken(IDENTIFIER);
  }
```

通过以下辅助函数来定义：

_<u>lox/Scanner.java，在 peekNext()方法之后添加：</u>_

```java
  private boolean isAlpha(char c) {
    return (c >= 'a' && c <= 'z') ||
           (c >= 'A' && c <= 'Z') ||
            c == '_';
  }

  private boolean isAlphaNumeric(char c) {
    return isAlpha(c) || isDigit(c);
  }
```

这样标识符就开始工作了。为了处理关键字，我们要查看标识符的词素是否是保留字之一。如果是，我们就使用该关键字特有的标记类型。我们在 map 中定义保留字的集合。

<u>_lox/Scanner.java，在 Scanner 类中添加：</u>_

```java
  private static final Map<String, TokenType> keywords;

  static {
    keywords = new HashMap<>();
    keywords.put("and",    AND);
    keywords.put("class",  CLASS);
    keywords.put("else",   ELSE);
    keywords.put("false",  FALSE);
    keywords.put("for",    FOR);
    keywords.put("fun",    FUN);
    keywords.put("if",     IF);
    keywords.put("nil",    NIL);
    keywords.put("or",     OR);
    keywords.put("print",  PRINT);
    keywords.put("return", RETURN);
    keywords.put("super",  SUPER);
    keywords.put("this",   THIS);
    keywords.put("true",   TRUE);
    keywords.put("var",    VAR);
    keywords.put("while",  WHILE);
  }
```

接下来，在我们扫描到标识符之后，要检查是否与 map 中的某些项匹配。

_<u>lox/Scanner.java，在 identifier()方法中替换一行：</u>_

```java
    while (isAlphaNumeric(peek())) advance();

    // 替换部分开始
    String text = source.substring(start, current);
    TokenType type = keywords.get(text);
    if (type == null) type = IDENTIFIER;
    addToken(type);
    // 替换部分结束
  }
```

如果匹配的话，就使用关键字的标记类型。否则，就是一个普通的用户定义的标识符。

至此，我们就有了一个完整的扫描器，可以扫描整个 Lox 词法语法。启动 REPL，输入一些有效和无效的代码。它是否产生了你所期望的词法单元？试着想出一些有趣的边界情况，看看它是否能正确地处理它们。

[^1]: 一直以来，这项工作被称为 "扫描(scanning) "和 "词法分析(lexing)"（ "词法分析(lexical analysis)"的简称）。早在计算机还像 Winnebagos 一样大，但内存比你的手表还小的时候，有些人就用 "扫描 "来指代从磁盘上读取原始源代码字符并在内存中缓冲的那段代码。然后，"lexing "是后续阶段，对字符做有用的操作。现在，将源文件读入内存是很平常的事情，因此在编译器中很少出现不同的阶段。 因此，这两个术语基本上可以互换。
[^2]: `System.exit(64)`，对于退出代码，我使用 UNIX sysexts .h 头文件中定义的约定。这是我能找到的最接近标准的东西。
[^3]: 交互式提示符也被称为 REPL(发音像 rebel，但替换为 p)。它的名称来自于 Lisp，实现 Lisp 非常简单，只需围绕几个内置函数进行循环:`(print (eval (read)))`从嵌套最内的调用向外执行，读取一行输入，求值，打印结果，然后循环并再次执行。
[^4]: 说了这么多，对于这个解释器，我们要构建的只是基本框架。我很想谈谈交互式调试器、静态分析器和其它有趣的东西，但是篇幅实在有限。
[^5]: 我第一次实现 jlox 的时候正是如此。最后我把它拆出去了，因为对于本书的最小解释器来说，这有点过度设计了。
[^6]: 毕竟，字符串比较最终也会比对单个字符，这不正是扫描器的工作吗？
[^7]: 一些标记实现将位置存储为两个数字：从源文件开始到词素开始的偏移量，以及词素的长度。扫描器无论如何都会知道这些数字，因此计算这些数字没有任何开销。通过回头查看源文件并计算前面的换行数，可以将偏移量转换为行和列位置。这听起来很慢，确实如此。然而，只有当你需要向用户实际显示行和列的时候，你才需要这样做。大多数标记从来不会出现在错误信息中。对于这些标记，你花在提前计算位置信息上的时间越少越好。
[^8]: 我很痛心要对理论做这么多掩饰，尤其是当它像[乔姆斯基谱系](https://en.wikipedia.org/wiki/Chomsky_hierarchy)和[有限状态机](https://en.wikipedia.org/wiki/Finite-state_machine)那样有趣的时候。但说实话，其他的书比我写得好。[_Compilers: Principles, Techniques, and Tools_](https://en.wikipedia.org/wiki/Compilers:_Principles,_Techniques,_and_Tools)(常被称为“龙书”)是最经典的参考书。
[^9]: Lex 是由 Mike Lesk 和 Eric Schmidt 创建的。是的，就是那个曾任谷歌执行董事长的 Eric Schmidt。我并不是说编程语言是通往财富和名声的必经之路，但我们中至少已经有一位超级亿万富翁。
[^10]: 我知道很多人认为静态导入是一种不好的代码风格，但这样我就不必在扫描器和解析器中到处写`TokenType`了。恕我直言，在一本书中，每个字符都很重要
[^11]: 想知道这里为什么没有`/`吗？别担心，我们会解决的。
[^12]: 技术上来说，`match()`方法也是在做前瞻。`advance()`和`peek()`是基本运算符，`match()`将它们结合起来。
[^13]: 因为我们只会根据数字来判断数字字面量，这就意味着`-123`不是一个数字*字面量*。相反，`-123`是一个*表达式*，将`-`应用到数字字面量`123`。在实践中，结果是一样的，尽管它有一个有趣的边缘情况。试想一下，如果我们要在数字上添加方法调用：`print -123.abs();`，这里会输出`-123`，因为负号的优先级低于方法调用。我们可以通过将`-`作为数字字面值的一部分来解决这个问题。但接着考虑：`var n = 123; print -n.abs();`，结果仍然是`-123`，所以现在语言似乎不一致。无论你怎么做，有些情况最后都会变得很奇怪。
[^14]: Java 标准库中提供了[Character.isDigit()](<http://docs.oracle.com/javase/7/docs/api/java/lang/Character.html#isDigit(char)>)，这似乎是个不错的选择。唉，该方法中还允许梵文数字、全宽数字和其他我们不想要的有趣的东西。
[^15]: 我本可以让`peek()`方法接受一个参数来表示要前瞻的字符数，而不需要定义两个函数。但这样做就会允许前瞻任意长度的字符。提供两个函数可以让读者更清楚地知道，我们的扫描器最多只能向前看两个字符。
[^16]: 看一下这段讨厌的 C 代码：`---a;`，它有效吗？这取决于扫描器如何分割词素。如果扫描器看到的是`- --a;`，那它就可以被解析。但是这需要扫描器知道代码前后的语法结构，这比我们需要的更复杂。相反，最大匹配原则表明，扫描结果总是：`-- -a;`，它就会这样扫描，尽管这样做会在解析器中导致后面的语法错误。

---

## 习题

1、Python 和 Haskell 的语法不是*常规的*。 这是什么意思，为什么不是呢？

- Python 和 Haskell 都采用了对缩进敏感的语法，所以它们必须将缩进级别的变动识别为词法标记。这样做需要比较连续行的开头空格数量，这是使用常规语法无法做到的。

2、除了分隔标记——区分`print foo`和`printfoo`——空格在大多数语言中并没有什么用处。在 CoffeeScript、Ruby 和 C 预处理器中的一些隐秘的地方，空格确实会影响代码解析方式。在这些语言中，空格在什么地方，会有什么影响？

3、我们这里的扫描器和大多数扫描器一样，会丢弃注释和空格，因为解析器不需要这些。什么情况下你会写一个不丢弃这些的扫描器？它有什么用呢？

4、为 Lox 扫描器增加对 C 样式`/ * ... * /`屏蔽注释的支持。确保要处理其中的换行符。 考虑允许它们嵌套， 增加对嵌套的支持是否比你预期的工作更多？ 为什么？

---

## 设计笔记：隐藏的分号

现在的程序员已经被越来越多的语言选择宠坏了，对语法也越来越挑剔。他们希望自己的代码看起来干净、现代化。几乎每一种新语言都会放弃一个小的语法点（一些古老的语言，比如 BASIC 从来没有过），那就是将`;`作为显式的语句结束符。

相对地，它们将“有意义的”换行符看作是语句结束符。这里所说的“有意义的”是有挑战性的部分。尽管*大多数的*语句都是在同一行，但有时你需要将一个语句扩展到多行。这些混杂的换行符不应该被视作结束符。

大多数明显的应该忽略换行的情况都很容易发现，但也有少数讨厌的情况：

- 返回值在下一行：

  ```js
  if (condition) return;
  ("value");
  ```

  “value”是要返回的值吗？还是说我们有一个空的`return`语句，后面跟着包含一个字符串字面量的表达式语句。

- 下一行中有带圆括号的表达式：

  ```js
  func(parenthesized);
  ```

  这是一个对`func(parenthesized)`的调用，还是两个表达式语句，一个用于`func`，一个用于圆括号表达式？

- “-”号在下一行：

  ```js
  first - second;
  ```

  这是一个中缀表达式——`first - second`，还是两个表达式语句，一个是`first`，另一个是对`second`取负？

在所有这些情况下，无论是否将换行符作为分隔符，都会产生有效的代码，但可能不是用户想要的代码。在不同的语言中，有各种不同的规则来决定哪些换行符是分隔符。下面是几个例子：

- [Lua](https://www.lua.org/pil/1.1.html)完全忽略了换行符，但是仔细地控制了它的语法，因此在大多数情况下，语句之间根本不需要分隔符。这段代码是完全合法的：

  ```lua
  a = 1 b = 2
  ```

  Lua 要求 `return` 语句是一个块中的最后一条语句，从而避免` return` 问题。如果在关键字`end`之前、`return`之后有一个值，这个值*必须*是用于`return`。对于其他两种情况来说，Lua 允许显式的`;`并且期望用户使用它。在实践中，这种情况基本不会发生，因为在小括号或一元否定表达式语句中没有任何意义。

- [Go](https://golang.org/ref/spec#Semicolons)会处理扫描器中的换行。如果在词法单元之后出现换行，并且该词法标记是已知可能结束语句的少数标记类型之一，则将换行视为分号，否则就忽略它。Go 团队提供了一个规范的代码格式化程序[gofmt](https://golang.org/cmd/gofmt/)，整个软件生态系统非常热衷于使用它，这确保了常用样式的代码能够很好地遵循这个简单的规则。

- Python 将所有换行符都视为有效，除非在行末使用明确的反斜杠将其延续到下一行。但是，括号(`()`、`[]`或`{}`)内的任何换行都将被忽略。惯用的代码风格更倾向于后者。

  这条规则对 Python 很有效，因为它是一种高度面向语句的语言。特别是，Python 的语法确保了语句永远不会出现在表达式内。C 语言也是如此，但许多其他有 "lambda "或函数字面语法的语言则不然。

  举一个 JavaScript 中的例子：

  ```js
  console.log(function () {
    statement();
  });
  ```

  这里，`console.log()` *表达式*包含一个函数字面量，而这个函数字面量又包含` statement();`_语句_。

  如果要求*进入*一个嵌套在括号内的语句中，并且要求其中的换行是有意义的，那么 Python 将需要一套不同的隐式连接行的规则[^lambda]。

- JavaScript 的“[自动分号插入](https://www.ecma-international.org/ecma-262/5.1/#sec-7.9)”规则才是真正的奇葩。其他语言认为大多数换行符都是有意义的，只有少数换行符在多行语句中应该被忽略，而 JS 的假设恰恰相反。它将所有的换行符都视为无意义的空白，除非遇到解析错误。如果遇到了，它就会回过头来，尝试把之前的换行变成分号，以期得到正确的语法。

  如果我完全详细地介绍它是如何工作的，那么这个设计说明就会变成一篇设计檄文，更不用说 JavaScript 的“解决方案”从各种角度看都是个坏主意。真是一团糟。JavaScript 是我所知道的唯一（风格指南和语言本身背离）的语言，它的许多风格指南要求在每条语句后都显式地使用分号，但该语言却理论上允许您省略分号。

如果您要设计一种新的语言，则几乎可以肯定应该避免使用显式的语句终止符。 程序员和其他人类一样是时尚的动物，分号和 ALL CAPS KEYWORDS(全大写关键字)一样已经过时了。只是要确保您选择了一套适用于您语言的特定语法和习语的规则即可。不要重蹈 JavaScript 的覆辙。

[^lambda]: 现在你明白为什么 Python 中的`lambda`只允许单行的表达式体了吧。
