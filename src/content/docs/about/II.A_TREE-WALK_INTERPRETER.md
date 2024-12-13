---
title: II. Tree-Walk 解释器
description: Tree-walk
---

在这部分中，我们开始学习jlox，这是我们两个解释器中的第一个。编程语言是一个巨大的话题，其中有大量的概念和术语需要一下子塞进你的大脑。编程语言理论需要一定程度的脑力投入，你可能自上次微积分期末考试后就没这么投入过了。(幸运的是，这本书没有太多的理论。)


实现一个解释器需要一些架构技巧和设计模式，这在其他类型的应用程序中是不常见的，所以我们也要习惯于工程方面的东西。考虑到这些，我们会尽可能地让代码简单明了。

在不到2000行简洁的Java代码中，我们将为Lox构建一个完整的解释器，完全按照我们指定的方式实现该语言的每一个功能。前几章从头到尾介绍解释器的各个阶段——[扫描](http://craftinginterpreters.com/scanning.html)、[解析](http://craftinginterpreters.com/parsing-expressions.html)和[计算代码](http://craftinginterpreters.com/evaluating-expressions.html)。之后，我们逐步添加语言特性，将一个简单的计算器发展成一种成熟的脚本语言。

