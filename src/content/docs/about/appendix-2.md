---
title: 附录II
description:  Appendix II
---

为了方便你们学习，下面是我们为自动生成jlox语法树类而[构建的小脚本](http://www.craftinginterpreters.com/representing-code.html#metaprogramming-the-trees)所产生的代码。

## A2.1 表达式

表达式是我们看到的第一个语法树节点，在“表示代码”中介绍过。主要的Expr类定义了用于针对特定表达式类型进行调度的访问者接口，并将其它表达式子类作为嵌套类包含其中。

*<u>lox/Expr.java，创建新文件：</u>*

```c
package com.craftinginterpreters.lox;

import java.util.List;

abstract class Expr {
  interface Visitor<R> {
    R visitAssignExpr(Assign expr);
    R visitBinaryExpr(Binary expr);
    R visitCallExpr(Call expr);
    R visitGetExpr(Get expr);
    R visitGroupingExpr(Grouping expr);
    R visitLiteralExpr(Literal expr);
    R visitLogicalExpr(Logical expr);
    R visitSetExpr(Set expr);
    R visitSuperExpr(Super expr);
    R visitThisExpr(This expr);
    R visitUnaryExpr(Unary expr);
    R visitVariableExpr(Variable expr);
  }

  // Nested Expr classes here...

  abstract <R> R accept(Visitor<R> visitor);
}
```

### A2.1.1 赋值表达式

变量赋值在“表达式与状态”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Assign extends Expr {
    Assign(Token name, Expr value) {
      this.name = name;
      this.value = value;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitAssignExpr(this);
    }

    final Token name;
    final Expr value;
  }
```

### A2.1.2 Binary表达式

二元运算符在“表示代码”中介绍过。

*<u>lox/Expr.java，嵌套在类Expr中：</u>*

```c
  static class Binary extends Expr {
    Binary(Expr left, Token operator, Expr right) {
      this.left = left;
      this.operator = operator;
      this.right = right;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitBinaryExpr(this);
    }

    final Expr left;
    final Token operator;
    final Expr right;
  }
```

### A2.1.3 调用表达式

函数调用语句在“函数”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Call extends Expr {
    Call(Expr callee, Token paren, List<Expr> arguments) {
      this.callee = callee;
      this.paren = paren;
      this.arguments = arguments;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitCallExpr(this);
    }

    final Expr callee;
    final Token paren;
    final List<Expr> arguments;
  }
```

### A2.1.4 get 表达式

> Property access, or “get” expressions are introduced in “[Classes](http://www.craftinginterpreters.com/classes.html#properties-on-instances)”.

属性访问，或者说“get”表达式，在“类”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Get extends Expr {
    Get(Expr object, Token name) {
      this.object = object;
      this.name = name;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitGetExpr(this);
    }

    final Expr object;
    final Token name;
  }
```

### A2.1.5 分组表达式

使用括号进行分组的表达式在“表示代码”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Grouping extends Expr {
    Grouping(Expr expression) {
      this.expression = expression;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitGroupingExpr(this);
    }

    final Expr expression;
  }
```

### A2.1.6 字面量值表达

字面量值表达式在“表示代码”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Literal extends Expr {
    Literal(Object value) {
      this.value = value;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitLiteralExpr(this);
    }

    final Object value;
  }
```

### A2.1.7 逻辑表达式

逻辑运算符`and`和`or`在“控制流”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Logical extends Expr {
    Logical(Expr left, Token operator, Expr right) {
      this.left = left;
      this.operator = operator;
      this.right = right;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitLogicalExpr(this);
    }

    final Expr left;
    final Token operator;
    final Expr right;
  }
```

### A2.1.8 set 表达式

属性赋值，或者叫“set”表达式，在“类”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Set extends Expr {
    Set(Expr object, Token name, Expr value) {
      this.object = object;
      this.name = name;
      this.value = value;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitSetExpr(this);
    }

    final Expr object;
    final Token name;
    final Expr value;
  }
```

### A2.1.9 super 表达式

`super`表达式在“继承”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Super extends Expr {
    Super(Token keyword, Token method) {
      this.keyword = keyword;
      this.method = method;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitSuperExpr(this);
    }

    final Token keyword;
    final Token method;
  }
```

### A2.1.10 This 表达式

`this`表达式在“类”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class This extends Expr {
    This(Token keyword) {
      this.keyword = keyword;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitThisExpr(this);
    }

    final Token keyword;
  }
```

### A2.1.11 一元表达式

一元运算符在“表示代码”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Unary extends Expr {
    Unary(Token operator, Expr right) {
      this.operator = operator;
      this.right = right;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitUnaryExpr(this);
    }

    final Token operator;
    final Expr right;
  }
```

### A2.1.12 变量表达式

变量访问表达式在“语句和状态”中介绍过。

*<u>lox/Expr.java，嵌套在Expr类中：</u>*

```c
  static class Variable extends Expr {
    Variable(Token name) {
      this.name = name;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitVariableExpr(this);
    }

    final Token name;
  }
```

## A2.2 语句

语句形成了独立于表达式的第二个语法树节点层次。我们在“声明和状态”中添加了前几个。

*<u>lox/Stmt.java，创建新文件：</u>*

```c
package com.craftinginterpreters.lox;

import java.util.List;

abstract class Stmt {
  interface Visitor<R> {
    R visitBlockStmt(Block stmt);
    R visitClassStmt(Class stmt);
    R visitExpressionStmt(Expression stmt);
    R visitFunctionStmt(Function stmt);
    R visitIfStmt(If stmt);
    R visitPrintStmt(Print stmt);
    R visitReturnStmt(Return stmt);
    R visitVarStmt(Var stmt);
    R visitWhileStmt(While stmt);
  }

  // Nested Stmt classes here...

  abstract <R> R accept(Visitor<R> visitor);
}
```

### A2.2.1 块语句

> The curly-braced block statement that defines a local scope is introduced in “[Statements and State](http://www.craftinginterpreters.com/statements-and-state.html#block-syntax-and-semantics)”.

在“语句和状态”中介绍过的花括号块语句，可以定义一个局部作用域。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Block extends Stmt {
    Block(List<Stmt> statements) {
      this.statements = statements;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitBlockStmt(this);
    }

    final List<Stmt> statements;
  }
```


### A2 . 2 . 2 Class statement

> Class declarations are introduced in, unsurprisingly, “[Classes](http://www.craftinginterpreters.com/classes.html#class-declarations)”.

类声明是在“类”中介绍的，毫不意外。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Class extends Stmt {
    Class(Token name,
          Expr.Variable superclass,
          List<Stmt.Function> methods) {
      this.name = name;
      this.superclass = superclass;
      this.methods = methods;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitClassStmt(this);
    }

    final Token name;
    final Expr.Variable superclass;
    final List<Stmt.Function> methods;
  }
```

### A2.2.3 Expression statement

表达式语句在“语句和状态”中介绍过。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Expression extends Stmt {
    Expression(Expr expression) {
      this.expression = expression;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitExpressionStmt(this);
    }

    final Expr expression;
  }
```

### A2.2.4 Function statement

函数声明是在“函数”中介绍的。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Function extends Stmt {
    Function(Token name, List<Token> params, List<Stmt> body) {
      this.name = name;
      this.params = params;
      this.body = body;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitFunctionStmt(this);
    }

    final Token name;
    final List<Token> params;
    final List<Stmt> body;
  }
```

### A2.2.5 If statement

`if`语句在“控制流”中介绍过。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class If extends Stmt {
    If(Expr condition, Stmt thenBranch, Stmt elseBranch) {
      this.condition = condition;
      this.thenBranch = thenBranch;
      this.elseBranch = elseBranch;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitIfStmt(this);
    }

    final Expr condition;
    final Stmt thenBranch;
    final Stmt elseBranch;
  }
```

### A2.2.6 Print statement

`print`语句在“语句和状态”中介绍过。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Print extends Stmt {
    Print(Expr expression) {
      this.expression = expression;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitPrintStmt(this);
    }

    final Expr expression;
  }
```

### A2.2.7 Return statement

你需要一个函数才能返回，所以`return`语句是在“函数”中介绍的。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Return extends Stmt {
    Return(Token keyword, Expr value) {
      this.keyword = keyword;
      this.value = value;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitReturnStmt(this);
    }

    final Token keyword;
    final Expr value;
  }
```

### A2.2.8 Variable statement

变量声明在“语句和状态”中介绍过。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class Var extends Stmt {
    Var(Token name, Expr initializer) {
      this.name = name;
      this.initializer = initializer;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitVarStmt(this);
    }

    final Token name;
    final Expr initializer;
  }
```

### A2.2.9 While statement

`while`语句在“控制流”中介绍过。

*<u>lox/Stmt.java，嵌套在Stmt类中：</u>*

```c
  static class While extends Stmt {
    While(Expr condition, Stmt body) {
      this.condition = condition;
      this.body = body;
    }

    @Override
    <R> R accept(Visitor<R> visitor) {
      return visitor.visitWhileStmt(this);
    }

    final Expr condition;
    final Stmt body;
  }
```