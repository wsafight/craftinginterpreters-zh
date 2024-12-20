---
title: 附录 I
description: Appendix I
---

这里有一份 Lox 的完整语法。介绍语言每个部分的章节中都包含对应的语法规则，但这里将它们全部收录在一起了。

## A1.1 语法

语法用于将词法标识（token）的线性序列解析为嵌套的语法树结构。它从匹配整个 Lox 程序（或单条 REPL 输入）的第一个规则开始。

```
program        → declaration* EOF ;
```

### A1.1.1 声明

一个程序就是一系列的声明，也就是绑定新标识符或其它 statement 类型的语句。

```
declaration    → classDecl
               | funDecl
               | varDecl
               | statement ;

classDecl      → "class" IDENTIFIER ( "<" IDENTIFIER )?
                 "{" function* "}" ;
funDecl        → "fun" function ;
varDecl        → "var" IDENTIFIER ( "=" expression )? ";" ;
```

### A1.1.2 语句

其余的语句规则会产生副作用，但不会引入绑定。

```
statement      → exprStmt
               | forStmt
               | ifStmt
               | printStmt
               | returnStmt
               | whileStmt
               | block ;

exprStmt       → expression ";" ;
forStmt        → "for" "(" ( varDecl | exprStmt | ";" )
                           expression? ";"
                           expression? ")" statement ;
ifStmt         → "if" "(" expression ")" statement
                 ( "else" statement )? ;
printStmt      → "print" expression ";" ;
returnStmt     → "return" expression? ";" ;
whileStmt      → "while" "(" expression ")" statement ;
block          → "{" declaration* "}" ;
```

请注意，`block`是一个语句规则，但在其它规则中也作为非终止符使用，用于表示函数体等内容。

### A1.1.3 表达式

表达式会产生值。Lox 有许多具有不同优先级的一元或二元运算符。一些语言的语法中没有直接编码优先级关系，而是在其它地方指定。在这里，我们为每个优先级使用单独的规则，使其明确。

```
expression     → assignment ;

assignment     → ( call "." )? IDENTIFIER "=" assignment
               | logic_or ;

logic_or       → logic_and ( "or" logic_and )* ;
logic_and      → equality ( "and" equality )* ;
equality       → comparison ( ( "!=" | "==" ) comparison )* ;
comparison     → term ( ( ">" | ">=" | "<" | "<=" ) term )* ;
term           → factor ( ( "-" | "+" ) factor )* ;
factor         → unary ( ( "/" | "*" ) unary )* ;

unary          → ( "!" | "-" ) unary | call ;
call           → primary ( "(" arguments? ")" | "." IDENTIFIER )* ;
primary        → "true" | "false" | "nil" | "this"
               | NUMBER | STRING | IDENTIFIER | "(" expression ")"
               | "super" "." IDENTIFIER ;
```

### A1.1.4 实用规则

为了使上面的规则更简洁一点，一些语法被拆分为几个重复使用的辅助规则。

```
function       → IDENTIFIER "(" parameters? ")" block ;
parameters     → IDENTIFIER ( "," IDENTIFIER )* ;
arguments      → expression ( "," expression )* ;
```

## A1.2 词法

词法被扫描器用来将字符分组为词法标识（token）。语法是[上下文无关](https://en.wikipedia.org/wiki/Context-free_grammar)的，词法是[正则](https://en.wikipedia.org/wiki/Regular_grammar)的——注意这里没有递归规则。

```
NUMBER         → DIGIT+ ( "." DIGIT+ )? ;
STRING         → "\"" <any char except "\"">* "\"" ;
IDENTIFIER     → ALPHA ( ALPHA | DIGIT )* ;
ALPHA          → "a" ... "z" | "A" ... "Z" | "_" ;
DIGIT          → "0" ... "9" ;
```
