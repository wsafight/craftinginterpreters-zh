---
title: 29. 超类
description: Superclasses
---

> 你可以选择你的朋友，但无法选择你的家庭，所以不管你承认与否，他们都是你的亲属，而且不承认会让你显得很蠢。
>
> ​ —— Harper Lee, _To Kill a Mockingbird_

这是我们向虚拟机添加新功能的最后一章。我们已经把几乎所有的 Lox 语言都装进虚拟机中了。剩下的就是继承方法和调用超类方法。在本章之后还有一章，但是没有引入新的行为。它只是让现有的东西更快[^1]。坚持到本章结束，你将拥有一个完整的 Lox 实现。

本章中的一些内容会让你想起 jlox。我们解决超类调用的方式几乎是一样的，即便是从 clox 这种在栈中存储状态的更复杂的机制来看。但这次我们会用一种完全不同的、更快的方式来处理继承方法的调用。

## 29.1 继承方法

我们会从方法继承开始，因为它是比较简单的部分。为了恢复你的记忆，Lox 的继承语法如下所示：

```typescript
class Doughnut {
  cook() {
    print "Dunk in the fryer.";
  }
}

class Cruller < Doughnut {
  finish() {
    print "Glaze with icing.";
  }
}
```

这里，Culler 类继承自 Doughnut，因此，Cruller 的实例继承了`cook()`方法。我不明白我为什么要反复强调这个，你知道继承是怎么回事。让我们开始编译新语法。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  currentClass = &classCompiler;
  // 新增部分开始
  if (match(TOKEN_LESS)) {
    consume(TOKEN_IDENTIFIER, "Expect superclass name.");
    variable(false);
    namedVariable(className, false);
    emitByte(OP_INHERIT);
  }
  // 新增部分结束
  namedVariable(className, false);
```

在编译类名之后，如果下一个标识是`<`，那我们就找到了一个超类子句。我们消耗超类的标识符，然后调用`variable()`。该函数接受前面消耗的标识，将其视为变量引用，并发出代码来加载变量的值。换句话说，它通过名称查找超类并将其压入栈中。

之后，我们调用`namedVariable()`将进行继承的子类加载到栈中，接着是`OP_INHERIT`指令。该指令将超类与新的子类连接起来。在上一章中，我们定义了一条`OP_METHOD`指令，通过向已有类对象的方法表中添加方法来改变它。这里是类似的——`OP_INHERIT`指令接受一个现有的类，并对其应用继承的效果。

在前面的例子中，当编译器处理这些语法时：

```
class Cruller < Doughnut {
```

结果就是这个字节码：

![The series of bytecode instructions for a Cruller class inheriting from Doughnut.](./inherit-stack.png)

在我们实现新的`OP_INHERIT`指令之前，还需要检测一个边界情况。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
    variable(false);
    // 新增部分开始
    if (identifiersEqual(&className, &parser.previous)) {
      error("A class can't inherit from itself.");
    }
    // 新增部分结束
    namedVariable(className, false);
```

一个类不能成为它自己的超类[^2]。除非你能接触到一个核物理学家和一辆改装过的 DeLorean 汽车【译者注：电影《回到未来》的梗】，否则你无法继承自己。

### 29.1.1 执行继承

现在来看新指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_CLASS,
  // 新增部分开始
  OP_INHERIT,
  // 新增部分结束
  OP_METHOD
```

不需要担心任何操作数。我们需要的两个值——超类和子类——都可以在栈中找到。这意味着反汇编很容易。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return constantInstruction("OP_CLASS", chunk, offset);
    // 新增部分开始
    case OP_INHERIT:
      return simpleInstruction("OP_INHERIT", offset);
    // 新增部分结束
    case OP_METHOD:
```

解释器是行为发生的地方。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        break;
      // 新增部分开始
      case OP_INHERIT: {
        Value superclass = peek(1);
        ObjClass* subclass = AS_CLASS(peek(0));
        tableAddAll(&AS_CLASS(superclass)->methods,
                    &subclass->methods);
        pop(); // Subclass.
        break;
      }
      // 新增部分结束
      case OP_METHOD:
```

从栈顶往下，我们依次有子类，然后是超类。我们获取这两个类，然后进行继承。这就是 clox 与 jlox 不同的地方。在我们的第一个解释器中，每个子类都存储了一个对其超类的引用。在访问方法时，如果我们没有在子类方法表中找到它，就通过继承链递归遍历每个祖先的方法表，直到找到该方法。

例如，在 Cruller 的实例上调用`cook()`方法，jlox 会这样做：

![Resolving a call to cook() in an instance of Cruller means walking the superclass chain.](./jlox-resolve.png)

在方法*调用*期间要做大量的工作。这很慢，而且更糟糕的是，继承的方法在祖先链上越远，它就越慢。这不是一个好的性能故事。

新方法则要快得多。当子类被声明时，我们将继承类的所有方法复制到子类自己的方法表中。之后，当我们*调用*某个方法时，从超类继承的任何方法都可以在子类自己的方法表中找到。继承根本不需要做额外的运行时工作。当类被声明时，工作就完成了。这意味着继承的方法和普通方法调用一样快——只需要一次哈希表查询[^3]。

![Resolving a call to cook() in an instance of Cruller which has the method in its own method table.](./clox-resolve.png)

我有时听到这种技术被称为“向下复制继承”。它简单而快速，但是，与大多数优化一样，你只能在特定的约束条件下使用它。它适用于 Lox，是因为 Lox 的类是*关闭*的。一旦某个类的声明执行完毕，该类的方法集就永远不能更改。

在 Ruby、Python 和 JavaScript 等语言中，可以打开一个现有的类，并将一些新方法加入其中，甚至删除方法。这会破坏我们的优化，因为如果这些修改在子类声明执行*之后*发生在超类上，子类就不会获得这些变化。这就打破了用户的期望，即继承总是反映超类的当前状态[^4]。

幸运的是（我猜对于喜欢这一特性的用户来说不算幸运），Lox 不允许猴子补丁或鸭子打洞，所以我们可以安全的应用这种优化。

那方法重写呢？将超类的方法复制到子类的方法表中，不会与子类自己的方法发生冲突吗？幸运的是，不会。我们是在创建子类的`OP_CLASS`指令之后、但在任何方法声明和`OP_METHOD`指令被编译之前发出`OP_INHERIT`指令。当我们将超类的方法复制下来时，子类的方法表是空的。子类重写的任何方法都会覆盖表中那些继承的条目。

### 29.1.2 无效超类

我们的实现简单而快速，这正是我喜欢我的 VM 代码的原因。但它并不健壮。没有什么能阻止用户继承一个根本不是类的对象：

```typescript
var NotClass = "So not a class";
class OhNo < NotClass {}
```

显然，任何一个有自尊心的程序员都不会写这种东西，但我们必须堤防那些没有自尊心的潜在 Lox 用户。一个简单的运行时检查就可以解决这个问题。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        Value superclass = peek(1);
        // 新增部分开始
        if (!IS_CLASS(superclass)) {
          runtimeError("Superclass must be a class.");
          return INTERPRET_RUNTIME_ERROR;
        }
        // 新增部分结束
        ObjClass* subclass = AS_CLASS(peek(0));
```

如果我们从超类子句的标识符中加载到的值不是 ObjClass，就报告一个运行时错误，让用户知道我们对他们及其代码的看法。

## 29.2 存储超类

你是否注意到，在我们添加方法继承时，实际上并没有添加任何从子类指向超类的引用？我们把继承的方法复制到子类之后，就完全忘记了超类。我们不需要保存超类的句柄，所以我们没有这样做。

这不足以支持超类调用。因为子类可能会覆盖超类方法[^5]，我们需要能够获得超类方法表。在讨论这个机制之前，我想让你回忆一下如何静态解析超类调用。

回顾 jlox 的光辉岁月，我给你展示了这个棘手的示例，来解释超类调用的分派方式：

```typescript
class A {
  method() {
    print "A method";
  }
}

class B < A {
  method() {
    print "B method";
  }

  test() {
    super.method();
  }
}

class C < B {}

C().test();
```

在`test()`方法的主体中，`this`是 C 的一个实例。如果超类调用是在*接收器*的超类中来解析的，那我们会在 C 的超类 B 中寻找方法。但是超类调用是在*发生超类调用的外围类*的超类中解析的。在本例中，我们在 B 的`test()`方法中，因此超类是 A，程序应该打印“A method”。

这意味着超类调用不是根据运行时的实例进行动态解析的。用于查找方法的超类是调用发生位置的一个静态（实际上是词法）属性。当我们在 jlox 中添加继承时，我们利用了这种静态优势，将超类存储在我们用于所有词法作用域的同一个 Environment 结构中。就好像解释器看到的程序是这样的：

```typescript
class A {
  method() {
    print "A method";
  }
}

var Bs_super = A;
class B < A {
  method() {
    print "B method";
  }

  test() {
    runtimeSuperCall(Bs_super, "method");
  }
}

var Cs_super = B;
class C < B {}

C().test();
```

每个子类都有一个隐藏变量，用于存储对其超类的引用。当我们需要执行一个超类调用时，我们就从这个变量访问超类，并告诉运行时从那里开始查找方法。

我们在 clox 中采用相同的方法。不同之处在于，我们使用的是字节码虚拟机的值栈和上值系统，而不是 jlox 的堆分配的 Environment 类。机制有些不同，但总体效果是一样的。

### 29.2.1 超类局部变量

我们的编译器已经发出了将超类加载到栈中的代码。我们不将这个槽看作是临时的，而是创建一个新的作用域，并将其作为一个局部变量。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
    }
    // 新增部分开始
    beginScope();
    addLocal(syntheticToken("super"));
    defineVariable(0);
    // 新增部分结束
    namedVariable(className, false);
    emitByte(OP_INHERIT);
```

创建一个新的词法作用域可以确保，如果我们在同一个作用域中声明两个类，每个类都有一个不同的局部槽来存储其超类。由于我们总是将该变量命名为“super”，如果我们不为每个子类创建作用域，那么这些变量就会发生冲突。

我们将该变量命名为“super”，与我们使用“this”作为`this`表达式解析得到的隐藏局部变量名称的原因相同：“super”是一个保留字，它可以保证编译器的隐藏变量不会与用户定义的变量发生冲突。

不同之处在于，在编译`this`表达式时，我们可以很方便地使用一个标识，词素是`this`。在这里我们就没那么幸运了。相对地，我们添加一个小的辅助函数，来为给定的常量字符串创建一个合成标识[^6]。

_<u>compiler.c，在 variable()方法后添加代码：</u>_

```c
static Token syntheticToken(const char* text) {
  Token token;
  token.start = text;
  token.length = (int)strlen(text);
  return token;
}
```

因为我们为超类变量打开了一个局部作用域，我们还需要关闭它。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  emitByte(OP_POP);
  // 新增部分开始
  if (classCompiler.hasSuperclass) {
    endScope();
  }
  // 新增部分结束
  currentClass = currentClass->enclosing;
```

在编译完类的主体及其方法后，我们会弹出作用域并丢弃“super”变量。这样，该变量在子类的所有方法中被都可以访问。这是一个有点无意义的优化，但我们只在有超类子句的情况下创建作用域。因此，只有在有超类的情况下，我们才需要关闭这个作用域。

为了记录是否有超类，我们可以在`classDeclaration()`中声明一个局部变量。但是很快，编译器中的其它函数需要知道外层的类是否是子类。所以我们不妨帮帮未来的自己，现在就把它作为一个字段存储在 ClassCompiler 中。

_<u>compiler.c，在结构体 ClassCompiler 中添加代码：</u>_

```c
typedef struct ClassCompiler {
  struct ClassCompiler* enclosing;
  // 新增部分开始
  bool hasSuperclass;
  // 新增部分结束
} ClassCompiler;
```

当我们第一次初始化某个 ClassCompiler 时，我们假定它不是子类。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  ClassCompiler classCompiler;
  // 新增部分开始
  classCompiler.hasSuperclass = false;
  // 新增部分结束
  classCompiler.enclosing = currentClass;
```

然后，如果看到超类子句，我们就知道正在编译一个子类。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
    emitByte(OP_INHERIT);
    // 新增部分开始
    classCompiler.hasSuperclass = true;
    // 新增部分结束
  }
```

这种机制在运行时为我们提供了一种方法，可以从子类的任何方法中访问外层子类的超类对象——只需发出代码来加载名为“super”的变量。这个变量是方法主体之外的一个局部变量，但是我们现有的上值支持 VM 在方法主体内、甚至是嵌套方法内的函数中捕获该局部变量。

## 29.3 超类调用

有了这个运行时支持，我们就可以实现超类调用了。跟之前一样，我们从前端到后端，先从新语法开始。超类调用，自然是以`super`关键字开始[^7]。

_<u>compiler.c，替换 1 行：</u>_

```c
  [TOKEN_RETURN]        = {NULL,     NULL,   PREC_NONE},
  // 替换部分开始
  [TOKEN_SUPER]         = {super_,   NULL,   PREC_NONE},
  // 替换部分结束
  [TOKEN_THIS]          = {this_,    NULL,   PREC_NONE},
```

当表达式解析器落在一个`super`标识时，控制流会跳转到一个新的解析函数，该函数的开头是这样的：

_<u>compiler.c，在 syntheticToken()方法后添加代码：</u>_

```c
static void super_(bool canAssign) {
  consume(TOKEN_DOT, "Expect '.' after 'super'.");
  consume(TOKEN_IDENTIFIER, "Expect superclass method name.");
  uint8_t name = identifierConstant(&parser.previous);
}
```

这与我们编译`this`表达式的方式很不一样。与`this`不同，`super`标识不是一个独立的表达式[^8]。相反，它后面的点和方法名称是语法中不可分割的部分。但是，括号内的参数列表是独立的。和普通的方法访问一样，Lox 支持以闭包的方式获得对超类方法的引用，而不必调用它：

```typescript
class A {
  method() {
    print "A";
  }
}

class B < A {
  method() {
    var closure = super.method;
    closure(); // Prints "A".
  }
}
```

换句话说，Lox 并没有真正的超类*调用（call）*表达式，它有的是超类*访问（access）*表达式，如果你愿意，可以选择立即调用。因此，当编译器碰到一个`super`标识时，我们会消费后续的`.`标识，然后寻找一个方法名称。方法是动态查找的，所以我们使用`identifierConstant()`来获取方法名标识的词素，并将其存储在常量表中，就像我们对属性访问表达式所做的那样。

下面是编译器在消费这些标识之后做的事情：

_<u>compiler.c，在 super\_()方法中添加代码：</u>_

```c
  uint8_t name = identifierConstant(&parser.previous);
  // 新增部分开始
  namedVariable(syntheticToken("this"), false);
  namedVariable(syntheticToken("super"), false);
  emitBytes(OP_GET_SUPER, name);
  // 新增部分结束
}
```

为了在*当前实例*上访问一个*超类方法*，运行时需要接收器*和*外围方法所在类的超类。第一个`namedVariable()`调用产生代码来查找存储在隐藏变量“this”中的当前接收器，并将其压入栈中。第二个`namedVariable()`调用产生代码，从它的“super”变量中查找超类，并将其推入栈顶。

最后，我们发出一条新的`OP_GET_SUPER`指令，其操作数为方法名称的常量表索引。你脑子里装的东西太多了。为了使它具体化，请看下面的示例程序：

```typescript
class Doughnut {
  cook() {
    print "Dunk in the fryer.";
    this.finish("sprinkles");
  }

  finish(ingredient) {
    print "Finish with " + ingredient;
  }
}

class Cruller < Doughnut {
  finish(ingredient) {
    // No sprinkles, always icing.
    super.finish("icing");
  }
}
```

`super.finish("icing")`发出的字节码看起来像是这样的：

![The series of bytecode instructions for calling super.finish().](./super-instructions.png)

前三条指令让运行时获得了执行超类访问时需要的三条信息：

1. 第一条指令将**实例**加载到栈中。
2. 第二条指令加载了**将用于解析方法的超类**。
3. 然后，新的`OP_GET_SUPER`指令将**要访问的方法名称**编码为操作数。

剩下的指令是用于计算参数列表和调用函数的常规字节码。

我们几乎已经准备好在解释器中实现新的`OP_GET_SUPER`指令了。但在此之前，编译器需要负责报告一些错误。

_<u>compiler.c，在 super\_()方法中添加代码：</u>_

```c
static void super_(bool canAssign) {
  // 新增部分开始
  if (currentClass == NULL) {
    error("Can't use 'super' outside of a class.");
  } else if (!currentClass->hasSuperclass) {
    error("Can't use 'super' in a class with no superclass.");
  }
  // 新增部分结束
  consume(TOKEN_DOT, "Expect '.' after 'super'.");
```

超类调用只有在方法主体（或方法中嵌套的函数）中才有意义，而且只在具有超类的某个类的方法中才有意义。我们使用`currentClass`的值来检测这两种情况。如果它是`NULL`或者指向一个没有超类的类，我们就报告这些错误。

### 29.3.1 执行超类访问

假设用户没有在不允许的地方使用`super`表达式，他们的代码将从编译器传递到运行时。我们已经有了一个新指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_SET_PROPERTY,
  // 新增部分开始
  OP_GET_SUPER,
  // 新增部分结束
  OP_EQUAL,
```

我们像对其它需要常量表索引操作数的操作码一样对它进行反汇编。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return constantInstruction("OP_SET_PROPERTY", chunk, offset);
    // 新增部分开始
    case OP_GET_SUPER:
      return constantInstruction("OP_GET_SUPER", chunk, offset);
    // 新增部分结束
    case OP_EQUAL:
```

你可能预想这是一件比较困难的事，但解释新指令与执行正常的属性访问类似。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_GET_SUPER: {
        ObjString* name = READ_STRING();
        ObjClass* superclass = AS_CLASS(pop());

        if (!bindMethod(superclass, name)) {
          return INTERPRET_RUNTIME_ERROR;
        }
        break;
      }
      // 新增部分结束
      case OP_EQUAL: {
```

和属性一样，我们从常量表中读取方法名。然后我们将其传递给`bindMethod()`，该方法会在给定类的方法表中查找方法，并创建一个 ObjBoundMethod 将结果闭包与当前实例相绑定。

关键的区别在于将*哪个*类传递给`bindMethod()`。对于普通的属性访问，我们使用 ObjInstances 自己的类，这为我们提供了我们想要的动态分派。对于超类调用，我们不使用实例的类。相反，我们使用静态分析得到的外层类的超类，编译器已经确保它在栈顶等着我们[^9]。

我们弹出该超类并将其传递给`bindMethod()`，该方法会正确地跳过该超类与实例本身的类之间的任何子类覆写的方法。它还正确地包含了超类从其任何超类中继承的方法。

其余的行为都是一样的。超类弹出栈使得实例位于栈顶。当`bindMethod()`成功时，它会弹出实例并压入新的已绑定方法。否则，它会报告一个运行时错误并返回`false`。在这种情况下，我们中止解释器。

### 29.3.2 更快的超类调用

我们现在有了对超类方法的访问。由于返回的对象是一个你可以稍后调用的 ObjBoundMethod，我们也就有了可用的超类*调用*。就像上一章一样，我们的虚拟机现在已经有了完整、正确的语义。

但是，也和上一章一样，它很慢。同样，我们为每个超类调用在堆中分配了一个 ObjBoundMethod，尽管大多数时候下一个指令就是`OP_CALL`，它会立即解包该已绑定方法，调用它，然后丢弃它。事实上，超类调用比普通方法调用更有可能出现这种情况。至少在方法调用中，用户有可能实际上在调用存储在字段中的函数。在超类调用中，你肯定是在查找一个方法。唯一的问题在于你是否立即调用它。

如果编译器看到超类方法名称后面有一个左括号，它肯定能自己回答这个问题，所以我们会继续执行与方法调用相同的优化。去掉加载超类并发出`OP_GET_SUPER`的两行代码，替换为这个：

_<u>compiler.c，在 super\_()方法中替换 2 行：</u>_

```c
  namedVariable(syntheticToken("this"), false);
  // 替换部分开始
  if (match(TOKEN_LEFT_PAREN)) {
    uint8_t argCount = argumentList();
    namedVariable(syntheticToken("super"), false);
    emitBytes(OP_SUPER_INVOKE, name);
    emitByte(argCount);
  } else {
    namedVariable(syntheticToken("super"), false);
    emitBytes(OP_GET_SUPER, name);
  }
  // 替换部分结束
}
```

现在，在我们发出任何代码之前，我们要寻找一个带括号的参数列表。如果找到了，我们就编译它，任何加载超类，之后，我们发出一条新的`OP_SUPER_INVOKE`指令。这个超级指令结合了`OP_GET_SUPER`和`OP_CALL`的行为，所以它需要两个操作数：待查找的方法名称和要传递给它的参数数量。

否则，如果没有找到`(`，则继续像前面那样将表达式编译为一个超类访问，并发出一条`OP_GET_SUPER`指令。

沿着编译流水线向下，我们的第一站是一条新指令。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_INVOKE,
  // 新增部分开始
  OP_SUPER_INVOKE,
  // 新增部分结束
  OP_CLOSURE,
```

在那之后，是它的反汇编器支持。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return invokeInstruction("OP_INVOKE", chunk, offset);
    // 新增部分开始
    case OP_SUPER_INVOKE:
      return invokeInstruction("OP_SUPER_INVOKE", chunk, offset);
    // 新增部分结束
    case OP_CLOSURE: {
```

超类调用指令具有与`OP_INVOKE`相同的操作数集，因此我们复用同一个辅助函数对其反汇编。最后，流水线将我们带到解释器中。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        break;
      }
      // 新增部分开始
      case OP_SUPER_INVOKE: {
        ObjString* method = READ_STRING();
        int argCount = READ_BYTE();
        ObjClass* superclass = AS_CLASS(pop());
        if (!invokeFromClass(superclass, method, argCount)) {
          return INTERPRET_RUNTIME_ERROR;
        }
        frame = &vm.frames[vm.frameCount - 1];
        break;
      }
      // 新增部分结束
      case OP_CLOSURE: {
```

这一小段代码基本上是`OP_INVOKE`的实现，其中混杂了一点`OP_GET_SUPER`。不过，在堆栈的组织方式上有些不同。在未优化的超类调用中，超类会被弹出，并在调用的*参数*被执行之前替换为被解析函数的 ObjBoundMethod。这确保了在`OP_CALL`执行时，已绑定方法在参数列表*之下*，也就是运行时期望闭包调用所在的位置。

在我们优化的指令中，事情有点被打乱：

![The series of bytecode instructions for calling super.finish() using OP_SUPER_INVOKE.](./super-invoke.png)

现在，解析超类方法是执行的一部分，因此当我们查找方法时，参数需要已经在栈上。这意味着超类对象位于参数之上。

除此之外，其行为与`OP_GET_SUPER`后跟`OP_CALL`大致相同。首先，我们取出方法名和参数数量两个操作数。然后我们从栈顶弹出超类，这样我们就可以在它的方法表中查找方法。这方便地将堆栈设置为适合方法调用的状态。

我们将超类、方法名和参数数量传递给现有的`invokeFromClass()`函数。该函数在给定的类上查找给定的方法，并尝试用给定的元数创建一个对它的调用。如果找不到某个方法，它就返回 false，并退出解释器。否则，`invokeFromClass()`将一个新的 CallFrame 压入方法闭包的调用栈上。这会使解释器缓存的 CallFrame 指针失效，所以我们也要刷新`frame`。

## 29.4 一个完整的虚拟机

回顾一下我们创造了什么。根据我的计算，我们编写了大约 2500 行相当干净、简洁的 C 语言代码。这个小程序中包含了对 Lox 语言（相当高级）的完整实现，它有一个满是表达式类型的优先级表和一套控制流语句。我们实现了变量、函数、闭包、类、字段、方法和继承。

更令人印象深刻的是，我们的实现可以移植到任何带有 C 编译器的平台上，而且速度快到足以在实际生产中使用。我们有一个单遍字节码编译器，一个用于内部指令集的严格虚拟机解释器，紧凑的对象表示，一个用于存储变量而不需要堆分配的栈，以及一个精确的垃圾回收器。

如果你开始研究 Lua、Python 或 Ruby 的实现，你会惊讶于它们现在看起来有多熟悉。你已经真正提高了关于编程语言工作方式的知识水平，这反过来又使你对编程本身有了更深的理解。这就像你以前是个赛车手，现在你可以打开引擎盖，修改发动机了。

如果你愿意，可以在这里停下来。你拥有的两个 Lox 实现是完整的、功能齐全的。你造了这俩车，现在可以把它开到你想去的地方。但是，如果你想获得更多改装与调整的乐趣，以期在赛道上获得更佳的性能，还有一个章节。我们没有增加任何新的功能，但我们推出了几个经典的优化，以挤压出更多的性能。如果这听起来很有趣，请继续读下去……

[^1]: 这个“只是”并不意味着加速不重要！毕竟，我们的第二个虚拟机的全部目的就是比 jlox 有更好的性能。你可以认为，前面的 15 章都是“优化”。
[^2]: 有趣的是，根据我们实现方法继承的方式，我认为允许循环实际上不会在 clox 中引起任何问题。它不会做任何有用的事情，但我认为它不会导致崩溃或无限循环。
[^3]: 好吧，我想应该是两次哈希查询。因为首先我们必须确保实例上的字段不会遮蔽方法。
[^4]: 可以想见，在运行时改变某个类中以命令式定义的方法集会使得对程序的推理变得困难。这是一个非常强大的工具，但也是一个危险的工具。<BR>那些认为这个工具可能有点太危险的人，给它取了个不伦不类的名字“猴子补丁”，或者是更不体面的“鸭子打洞”。
[^5]: “可能”这个词也许不够有力。大概这个方法*已经*被重写了。否则，你为什么要费力地使用`super`而不是直接调用它呢？
[^6]: 我说“常量字符串”是因为标识不对其词素做任何内存管理。如果我们试图使用堆分配的字符串，最终会泄漏内存，因为它永远不会被释放。但是，C 语言字符串字面量的内存位于可执行文件的常量数据部分，永远不需要释放，所以我们这样没有问题。
[^7]: 就是这样，朋友，你要添加到解析表中的最后一项。
[^8]: 假设性问题：如果一个光秃秃的`super`标识是一个表达式，那么它会被计算为哪种对象呢？
[^9]: 与`OP_GET_PROPERTY`相比的另一个区别是，我们不会先尝试寻找遮蔽字段。字段不会被继承，所以`super`表达式总是解析为方法。<BR>如果 Lox 是一种使用*委托*而不是*继承*的基于原型的语言，那么就不是一个*类*继承另一个*类*，而是实例继承自（委托给）其它实例。在这种情况下，字段可以被继承，我们就需要在这里检查它们。

---

## 习题

1. 面向对象编程的一个原则是，类应该确保新对象处于有效状态。在 Lox 中，这意味着要定义一个填充实例字段的初始化器。继承使不变性复杂化，因为对于对象继承链中的所有类，实例必须处于有效状态。

   简单的部分是记住在每个子类的`init()`方法中调用`super.init()`。比较难的部分是字段。没有什么方法可以防止继承链中的两个类意外地声明相同的字段名。当这种情况发生时，它们会互相干扰彼此的字段，并可能让你的实例处于崩溃状态。

   如果 Lox 是你的语言，你会如何解决这个问题？如果你想改变语言，请实现你的更改。

2. 我们的向下复制继承优化之所以有效，仅仅是因为 Lox 不允许在类声明之后修改它的方法。这意味着我们不必担心子类中复制的方法与后面对超类的修改不同步。

   其它语言，如 Ruby，确实允许在事后修改类。像这样的语言实现如何支持类的修改，同时保持方法解析的效率呢？

3. 在 jlox 关于继承的章节中，我们有一个习题，是实现 BETA 语言的方法重写。再次解决这个习题，但这次是在 clox 中。下面是对之前习题的描述：

   在 Lox 中，和其它大多数面向对象的语言一样，当查找一个方法时，我们从类层次结构的底部开始，然后向上查找——子类的方法优于超类的方法。要想在子类方法中访问超类方法，可以使用`super`。

   [BETA](https://beta.cs.au.dk/)语言则采取了[相反的方法](http://journal.stuffwithstuff.com/2012/12/19/the-impoliteness-of-overriding-methods/)。当你调用某个方法时，它从类层次结构的顶部开始向下运行。超类方法优于子类方法。要想访问子类方法，超类方法中可以调用`inner()`，这有点像是`super`的反义词。它会链接到层次结构中的下一个方法。

   超类方法控制着子类何时何地被允许完善其行为。如果超类方法根本不调用`inner`，那么子类就没有办法覆写或修改超类的行为。

   去掉 Lox 中当前的覆写和`super`行为，替换为 BETA 的语义。简而言之：

   - 当调用某个类中的方法时，该类继承链上最高的方法优先。
   - 在方法体内部，对`inner`的调用，会沿着包含`inner`的类和`this`的类之间的继承链，在最近的子类中查找同名的方法。如果没有匹配的方法，`inner`调用就什么也不做。

   举例来说：

   ```typescript
   class Doughnut {
     cook() {
       print "Fry until golden brown.";
       inner();
       print "Place in a nice box.";
     }
   }

   class BostonCream < Doughnut {
     cook() {
       print "Pipe full of custard and coat with chocolate.";
     }
   }

   BostonCream().cook();
   ```

   这里应该打印：

   ```
   Fry until golden brown.
   Pipe full of custard and coat with chocolate.
   Place in a nice box.
   ```

   因为 clox 不仅仅是实现 Lox，而是要以良好的性能来实现，所以这次要尝试以效率为导向来解决这个问题。
