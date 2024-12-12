# craftinginterpreters_zh

[ [在线阅读](https://readonly.link/books/https://raw.githubusercontent.com/GuoYaxiang/craftinginterpreters_zh/main/book.json) ]

手写解释器教程《Crafting Interpreters》中文翻译。

原项目是 [craftinginterpreters](https://github.com/munificent/craftinginterpreters)，同时还有配套的英文书，可免费[在线阅读](https://www.craftinginterpreters.com/contents.html），如果您的英语阅读能力比较强，建议直接阅读原文。

该书由一门小型的自创语言 Lox 开始，分别使用 Java 和 C 实现了两种类型的解释器，jlox 和 clox，其中前者是将语法解析成 Java 中的表示代码，主要依赖 Java 本身的语法能力实现代码的真正运行；后者则采用了类似编译和虚拟机的机制，实现了一个看上去“更高效”的解释器。

使用 [starlight](https://starlight.astro.build/) 构建
