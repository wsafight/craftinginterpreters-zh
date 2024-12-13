---
title: 28. 方法和初始化器
description: Methods and Initializers
---

> 当你在舞池里时，除了跳舞，别无选择。
>
> ​ —— Umberto Eco, _The Mysterious Flame of Queen Loana_

对于我们的虚拟机来说，现在是时候通过赋予行为的方式为新生对象赋予生命了。也就是方法和方法调用。而且由于初始化器同样也属于这种特殊的方法，所以也要予以考虑。

所有这些都是我们以前的 jlox 解释器中所熟悉的领域。第二次旅行中的新内容是我们将实现一个重要的优化，使方法调用的速度比基线性能快 7 倍以上。但在此之前，我们得先把基本的东西弄好。

## 28.1 方法声明

没有方法调用，我们就无法优化方法调用，而没有可供调用的方法，我们就无法调用方法，因此我们从声明开始。

### 28.1.1 表示方法

我们通常从编译器开始，但这次让我们先搞定对象模型。clox 中方法的运行时表示形式与 jlox 相似。每个类都存储了一个方法的哈希表。键是方法名，每个值都是方法主体对应的 ObjClosure。

_<u>object.h，在结构体 ObjClass 中添加代码：</u>_

```c
typedef struct {
  Obj obj;
  ObjString* name;
  // 新增部分开始
  Table methods;
  // 新增部分结束
} ObjClass;
```

一个全新的类初始时得到的是空方法表。

_<u>object.c，在 newClass()方法中添加代码：</u>_

```c
  klass->name = name;
  // 新增部分开始
  initTable(&klass->methods);
  // 新增部分结束
  return klass;
```

ObjClass 结构体拥有该表的内存，因此当内存管理器释放某个类时，该表也应该被释放。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
    case OBJ_CLASS: {
      // 新增部分开始
      ObjClass* klass = (ObjClass*)object;
      freeTable(&klass->methods);
      // 新增部分结束
      FREE(ObjClass, object);
```

说到内存管理器，GC 需要通过类追踪到方法表。如果某个类仍然是可达的（可能是通过某个实例），那么它的所有方法当然也需要保留。

_<u>memory.c，在 blackenObject()方法中添加代码：</u>_

```c
      markObject((Obj*)klass->name);
      // 新增部分开始
      markTable(&klass->methods);
      // 新增部分结束
      break;
```

我们使用现有的`markTable()`函数，该函数可以追踪每个表项中的键字符串和值。

存储类方法的方式与 jlox 是非常类似的。不同之处在于如何填充该表。我们以前的解释器可以访问整个类声明及其包含的所有方法对应的 AST 节点。在运行时，解释器只是简单地遍历声明列表。

现在，编译器想要分发到运行时的每一条信息都必须通过一个扁平的字节码指令序列形式。我们如何接受一个可以包含任意大的方法集的类声明，并以字节码的形式将其表现出来？让我们跳到编译器上看看。

### 28.1.2 编译方法声明

上一章留给我们一个能解析类但只允许空主体的编译器。现在我们添加一些代码来解析大括号之间的一系列方法声明。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  consume(TOKEN_LEFT_BRACE, "Expect '{' before class body.");
  // 新增部分开始
  while (!check(TOKEN_RIGHT_BRACE) && !check(TOKEN_EOF)) {
    method();
  }
  // 新增部分结束
  consume(TOKEN_RIGHT_BRACE, "Expect '}' after class body.");
```

Lox 没有字段声明，因此，在主体块末尾的右括号之前的任何内容都必须是方法。当我们碰到最后的大括号或到达文件结尾时，就会停止编译方法。后一项检查可以确保我们的编译器不会在用户不小心忘记关闭大括号时陷入无限循环。

编译类声明的棘手之处在于，一个类可以声明任意数量的方法。运行时需要以某种方式查找并绑定所有这些方法。这会导致一个`OP_CLASS`指令中纳入了太多内容。相反，我们为类声明生成的字节码将这个过程分为一系列的指令。编译器已经发出了一条`OP_CLASS`指令，用来创建一个新的空 ObjClass 对象。然后它发出指令，将类存储在一个具有其名称的变量中[^1]。

现在，对于每个方法声明，我们发出一条新的`OP_METHOD`指令，将一个方法添加到该类中。当所有的`OP_METHOD`指令都执行完毕后，我们就得到了一个完整的类。尽管用户将类声明看作是单个原子操作，但虚拟机却将其实现为一系列的变化。

要定义一个新方法，VM 需要三样东西：

1. 方法名称。
2. 方法主体的闭包。
3. 绑定该方法的类。

我们会逐步编写编译器代码，看看它们是如何进入运行时的，从这里开始：

_<u>compiler.c，在 function()方法后添加代码：</u>_

```c
static void method() {
  consume(TOKEN_IDENTIFIER, "Expect method name.");
  uint8_t constant = identifierConstant(&parser.previous);
  emitBytes(OP_METHOD, constant);
}
```

像`OP_GET_PROPERTY`和其它在运行时需要名称的指令一样，编译器将方法名称标识的词素添加到常量表中，获得表索引。然后发出一个`OP_METHOD`指令，以该索引作为操作数。这就是名称。接下来是方法主体：

_<u>compiler.c，在 method()方法中添加代码：</u>_

```c
  uint8_t constant = identifierConstant(&parser.previous);
  // 新增部分开始
  FunctionType type = TYPE_FUNCTION;
  function(type);
  // 新增部分结束
  emitBytes(OP_METHOD, constant);
```

我们使用为编译函数声明而编写的`function()`辅助函数。该工具函数会编译后续的参数列表和函数主体。然后它发出创建 ObjClosure 的代码，并将其留在栈顶。在运行时，VM 会在那里找到这个闭包。

最后是要绑定方法的类。VM 在哪里可以找到它呢？不幸的是，当我们到达`OP_METHOD`指令时，我们还不知道它在哪里。如果用户在局部作用域中声明该类，那它可能在栈上。但是顶层的类声明最终会成为全局变量表中的 ObjClass[^2]。

不要担心。编译器确实知道类的*名称*。我们可以在消费完名称标识后捕获这个值。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  consume(TOKEN_IDENTIFIER, "Expect class name.");
  // 新增部分开始
  Token className = parser.previous;
  // 新增部分结束
  uint8_t nameConstant = identifierConstant(&parser.previous);
```

我们知道，其它具有该名称的声明不可能会遮蔽这个类。所以我们选择了简单的处理方式。在我们开始绑定方法之前，通过一些必要的代码，将类加载回栈顶。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  defineVariable(nameConstant);
  // 新增部分开始
  namedVariable(className, false);
  // 新增部分结束
  consume(TOKEN_LEFT_BRACE, "Expect '{' before class body.");
```

在编译类主体之前，我们调用`namedVariable()`。这个辅助函数会生成代码，将一个具有给定名称的变量加载到栈中[^3]。然后，我们编译方法。

这意味着，当我们执行每一条`OP_METHOD`指令时，栈顶是方法的闭包，它下面就是类。一旦我们到达了方法的末尾，我们就不再需要这个类，并告诉虚拟机将该它从栈中弹出。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  consume(TOKEN_RIGHT_BRACE, "Expect '}' after class body.");
  // 新增部分开始
  emitByte(OP_POP);
  // 新增部分结束
}
```

把所有这些放在一起，下面是一个可以扔给编译器的类声明示例：

```typescript
class Brunch {
  bacon() {}
  eggs() {}
}
```

鉴于此，下面是编译器生成的内容以及这些指令在运行时如何影响堆栈：

![The series of bytecode instructions for a class declaration with two methods.](./method-instructions.png)

我们剩下要做的就是为这个新的`OP_METHOD`指令实现运行时。

### 28.1.3 执行方法声明

首先我们定义操作码。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_CLASS,
  // 新增部分开始
  OP_METHOD
  // 新增部分结束
} OpCode;
```

我们像其它具有字符串常量操作数的指令一样对它进行反汇编。

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
    case OP_CLASS:
      return constantInstruction("OP_CLASS", chunk, offset);
    // 新增部分开始
    case OP_METHOD:
      return constantInstruction("OP_METHOD", chunk, offset);
    // 新增部分结束
    default:
```

在解释器中，我们也添加一个新的 case 分支。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        break;
      // 新增部分开始
      case OP_METHOD:
        defineMethod(READ_STRING());
        break;
      // 新增部分结束
    }
```

其中，我们从常量表中读取方法名称，并将其传递到这里：

_<u>vm.c，在 closeUpvalues()方法后添加代码：</u>_

```c
static void defineMethod(ObjString* name) {
  Value method = peek(0);
  ObjClass* klass = AS_CLASS(peek(1));
  tableSet(&klass->methods, name, method);
  pop();
}
```

方法闭包位于栈顶，在它将绑定的类的上方。我们读取这两个栈槽并将闭包存储到类的方法表中。然后弹出闭包，因为我们已经用完了。

注意，我们没有对闭包或类对象做任何的运行时类型检查。`AS_CLASS()`调用是安全的，因为编译器本身会生成使类位于栈槽的代码。虚拟机信任自己的编译器[^4]。

在完成一系列的`OP_METHOD`指令并且`OP_POP`弹出类后，我们将得到一个已填充好方法表的类，可以开始做事情了。下一步是将这些方法拉出来并使用它们。

## 28.2 方法引用

大多数情况下，方法被访问并立即被调用，导致了这种熟悉的语法：

```c
instance.method(argument);
```

但是请记住，在 Lox 和其它一些语言中，这两个步骤是不同的，可以分开。

```javascript
var closure = instance.method;
closure(argument);
```

由于用户可以将这些操作分开，所以我们必须分别实现它们。第一步是使用现有的点属性语法来访问实例的类中定义的方法。这应该返回某种类型的对象，然后用户可以向函数一样调用它。

明显的方式是，在类的方法表中查找该方法，并返回与该名称关联的 ObjClosure。但是我们也需要记住，当你访问一个方法时，`this`绑定到访问该方法的实例上。下面是我们在向 jlox 添加方法时的例子：

```typescript
class Person {
  sayName() {
    print this.name;
  }
}

var jane = Person();
jane.name = "Jane";

var method = jane.sayName;
method(); // ?
```

这里应该打印“Jane”，因此`.sayName`返回的对象在以后被调用时需要记住访问它的实例。在 jlox 中，我们通过解释器已有的堆分配的 Environment 类来实现这个“记忆”，该 Environment 类会处理所有的变量存储。。

我们的字节码虚拟机用一个更复杂的结构来存储状态。局部变量和临时变量在栈中，全局变量在哈希表中，而闭包中的变量使用上值。这就需要一个更复杂的跟踪 clox 中方法接收者的解决方案，以及一个新的运行时类型。

### 28.2.1 已绑定方法

当用户执行一个方法访问时，我们会找到该方法的闭包，并将其包装在一个新的“已绑定方法（bound method）”对象中[^5]，该对象会跟踪访问该方法的实例。这个已绑定对象可以像一个函数一样在稍后被调用。当被调用时，虚拟机会做一些小动作，将`this`连接到方法主体中的接收器。

下面是新的对象类型：

_<u>object.h，在结构体 ObjInstance 后添加代码：</u>_

```c
} ObjInstance;
// 新增部分开始
typedef struct {
  Obj obj;
  Value receiver;
  ObjClosure* method;
} ObjBoundMethod;
// 新增部分结束
ObjClass* newClass(ObjString* name);
```

它将接收器和方法闭包包装在一起。尽管方法只能在 ObjInstances 上调用，但接收器类型是 Value。因为虚拟机并不关心它拥有什么样的接收器，使用 Value 意味着当它需要传递给更多通用函数时，我们不必将指针转换回 Value。

新的结构体暗含了你现在已经熟悉的常规模板。对象类型枚举中的新值：

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
typedef enum {
  // 新增部分开始
  OBJ_BOUND_METHOD,
  // 新增部分结束
  OBJ_CLASS,
```

一个检查值类型的宏：

_<u>object.h，添加代码：</u>_

```c
#define OBJ_TYPE(value)        (AS_OBJ(value)->type)
// 新增部分开始
#define IS_BOUND_METHOD(value) isObjType(value, OBJ_BOUND_METHOD)
// 新增部分结束
#define IS_CLASS(value)        isObjType(value, OBJ_CLASS)
```

另一个将值转换为 ObjBoundMethod 指针的宏：

_<u>object.h，添加代码：</u>_

```c
#define IS_STRING(value)       isObjType(value, OBJ_STRING)
// 新增部分开始
#define AS_BOUND_METHOD(value) ((ObjBoundMethod*)AS_OBJ(value))
// 新增部分结束
#define AS_CLASS(value)        ((ObjClass*)AS_OBJ(value))
```

一个创建新 ObjBoundMethod 的函数：

_<u>object.h，在结构体 ObjBoundMethod 后添加代码：</u>_

```c
} ObjBoundMethod;
// 新增部分开始
ObjBoundMethod* newBoundMethod(Value receiver,
                               ObjClosure* method);
// 新增部分结束
ObjClass* newClass(ObjString* name);
```

以及该函数的实现：

_<u>object.c，在 allocateObject()方法后添加代码：</u>_

```c
ObjBoundMethod* newBoundMethod(Value receiver,
                               ObjClosure* method) {
  ObjBoundMethod* bound = ALLOCATE_OBJ(ObjBoundMethod,
                                       OBJ_BOUND_METHOD);
  bound->receiver = receiver;
  bound->method = method;
  return bound;
}
```

这个类似构造器的函数简单地存储了给定的闭包和接收器。当不再需要某个已绑定方法时，我们将其释放。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
  switch (object->type) {
    // 新增部分开始
    case OBJ_BOUND_METHOD:
      FREE(ObjBoundMethod, object);
      break;
    // 新增部分结束
    case OBJ_CLASS: {
```

已绑定方法有几个引用，但并不*拥有*它们，所以它只释放自己。但是，这些引用确实要被垃圾回收器跟踪到。

_<u>memory.c，在 blackenObject()方法中添加代码：</u>_

```c
  switch (object->type) {
    // 新增部分开始
    case OBJ_BOUND_METHOD: {
      ObjBoundMethod* bound = (ObjBoundMethod*)object;
      markValue(bound->receiver);
      markObject((Obj*)bound->method);
      break;
    }
    // 新增部分结束
    case OBJ_CLASS: {
```

这可以确保方法的句柄会将接收器保持在内存中，以便后续当你调用这个句柄时，`this`仍然可以找到这个对象。我们也会跟踪方法闭包[^6]。

所有对象要支持的最后一个操作是打印。

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
  switch (OBJ_TYPE(value)) {
    // 新增部分开始
    case OBJ_BOUND_METHOD:
      printFunction(AS_BOUND_METHOD(value)->method->function);
      break;
    // 新增部分结束
    case OBJ_CLASS:
```

已绑定方法的打印方式与函数完全相同。从用户的角度来看，已绑定方法*就是*一个函数，是一个可以被他们调用的对象。我们不会暴露虚拟机中使用不同的对象类型来实现已绑定方法的事实。

庆祝一下，因为我们刚刚到达了一个小小的里程碑。ObjBoundMethod 是要添加到 clox 中的最后一个运行时类型。你已经写完了最后的`IS_`和`AS_`宏。我们离本书的结尾只有几章了，而且我们已经接近一个完整的虚拟机了。

### 28.2.2 访问方法

我们来让新对象类型做点什么。方法是通过我们在上一章中实现的“点”属性语法进行访问的。编译器已经能够解析正确的表达式，并为它们发出`OP_GET_PROPERTY`指令。我们接下来只需要在运行时做适当改动。

当执行某个属性访问指令时，实例在栈顶。该指令的任务是找到一个具有给定名称的字段或方法，并将栈顶替换为所访问的属性。

解释器已经处理了字段，所以我们只需要在`OP_GET_PROPERTY`分支中扩展另一部分。

_<u>vm.c，在 run()方法中替换 2 行：</u>_

```c
          pop(); // Instance.
          push(value);
          break;
        }
        // 替换部分开始
        if (!bindMethod(instance->klass, name)) {
          return INTERPRET_RUNTIME_ERROR;
        }
        break;
        // 替换部分结束
      }
```

我们在查找接收器实例上字段的代码后面插入这部分逻辑。字段优先于方法，因此我们首先查找字段。如果实例确实不包含具有给定属性名称的字段，那么这个名称可能指向的是一个方法。

我们获取实例的类，并将其传递给新的`bindMethod()`辅助函数。如果该函数找到了方法，它会将该方法放在栈中并返回`true`。否则返回`false`，表示找不到具有该名称的方法。因为这个名称也不是字段，这意味着我们遇到了一个运行时错误，从而中止了解释器。

下面是这段精彩的逻辑：

_<u>vm.c，在 callValue()方法后添加代码：</u>_

```c
static bool bindMethod(ObjClass* klass, ObjString* name) {
  Value method;
  if (!tableGet(&klass->methods, name, &method)) {
    runtimeError("Undefined property '%s'.", name->chars);
    return false;
  }

  ObjBoundMethod* bound = newBoundMethod(peek(0),
                                         AS_CLOSURE(method));
  pop();
  push(OBJ_VAL(bound));
  return true;
}
```

首先，我们在类的方法表中查找具有指定名称的方法。如果我们没有找到，我们就报告一个运行时错误并退出。否则，我们获取该方法，并将其包装为一个新的 ObjBoundMethod。我们从栈顶获得接收器。最后，我们弹出实例，并将这个已绑定方法替换到栈顶。

举例来说：

```typescript
class Brunch {
  eggs() {}
}

var brunch = Brunch();
var eggs = brunch.eggs;
```

下面是虚拟机执行`brunch.eggs`表达式的`bindMethod()`调用时发生的情况：

![The stack changes caused by bindMethod().](./bind-method.png)

在底层有很多机制，但从用户的角度来看，他们只是得到了一个可以调用的函数。

### 28.2.3 调用方法

用户可以在类上声明方法，在实例上访问这些方法，并将已绑定的方法放到栈上[^7]。他们目前还不能使用这些已绑定方法做任何有意义的事。我们所缺少的操作就是调用他们。调用在`callValue()`中实现，所以我们在其中为新的对象类型添加一个 case 分支。

_<u>vm.c，在 callValue()方法中添加代码：</u>_

```c
    switch (OBJ_TYPE(callee)) {
      // 新增部分开始
      case OBJ_BOUND_METHOD: {
        ObjBoundMethod* bound = AS_BOUND_METHOD(callee);
        return call(bound->method, argCount);
      }
      // 新增部分结束
      case OBJ_CLASS: {
```

我们从 ObjBoundMethod 中抽取原始闭包，并使用现有的`call()`辅助函数，通过将对应 CallFrame 压入调用栈，来开始对该闭包的调用。有了这些，就能够运行下面这个 Lox 程序：

```typescript
class Scone {
  topping(first, second) {
    print "scone with " + first + " and " + second;
  }
}

var scone = Scone();
scone.topping("berries", "cream");
```

这是三大步。我们可以声明、访问和调用方法。但我们缺失了一些东西。我们费尽心思将方法闭包包装在一个绑定了接收器的对象中，但当我们调用方法时，根本没有使用那个接收器。

## 28 . 3 This

已绑定方法中需要保留接收器的原因在于，这样就可以在方法体内部访问接收器实例。Lox 通过`this`表达式暴露方法的接收器。现在是时候用一些新语法了。词法解析器已经将`this`当作一个特殊的标识类型，因此第一步是将该标识链接到解析表中。

_<u>compiler.c，替换 1 行：</u>_

```c
  [TOKEN_SUPER]         = {NULL,     NULL,   PREC_NONE},
  // 替换部分开始
  [TOKEN_THIS]          = {this_,    NULL,   PREC_NONE},
  // 替换部分结束
  [TOKEN_TRUE]          = {literal,  NULL,   PREC_NONE},
```

当解析器在前缀位置遇到一个`this`时，会派发给新的解析器函数[^8]。

_<u>compiler.c，在 variable()方法后添加：</u>_

```c
static void this_(bool canAssign) {
  variable(false);
}
```

对于 clox 中的`this`，我们将使用与 jlox 相同的技术。我们将`this`看作是一个具有词法作用域的局部变量，它的值被神奇地初始化了。像局部变量一样编译它意味着我们可以免费获得很多行为。特别是，引用`this`的方法对应的闭包会做正确的事情，并在上值中捕获接收器。

当解析器函数被调用时，`this`标识刚刚被使用，并且存储在上一个标识中。我们调用已有的`variable()`函数，它将标识符表达式编译为变量访问。它需要一个 Boolean 参数，用于判断编译器是否应该查找后续的`=`运算符并解析 setter。你不能给`this`赋值，所以我们传入`false`来禁止它。

`variable()`函数并不关心`this`是否有自己的标识类型，也不关心它是否是一个标识符。它很乐意将词素`this`当作一个变量名，然后用现有的作用域解析机制来查找它。现在，这种查找会失败，因为我们从未声明过名称为`this`的变量。现在是时候考虑一下接收器在内存中的位置了。

至少在每个局部变量被闭包捕获之前，clox 会将其存储在 VM 的栈中。编译器持续跟踪函数栈窗口中的哪个槽由哪些局部变量所拥有。如果你还记得，编译器通过声明一个名称为空字符串的局部变量来预留出栈槽 0。

对于函数调用来说，这个槽会存储被调用的函数。因为这个槽没有名字，所以函数主体永远不会访问它。你可以猜到接下来会发生什么。对于方法调用，我们可以重新利用这个槽来存储接收器。槽 0 会存储`this`绑定的实例。为了编译`this`表达式，编译器只需要给这个局部变量一个正确的名称。

_<u>compiler.c，在 initCompiler()方法中替换 2 行：</u>_

```c
  local->isCaptured = false;
  // 替换部分开始
  if (type != TYPE_FUNCTION) {
    local->name.start = "this";
    local->name.length = 4;
  } else {
    local->name.start = "";
    local->name.length = 0;
  }
  // 替换部分结束
}
```

我们只想对方法这样做。函数声明中没有`this`。事实上，它们不能声明一个名为`this`的变量，因此，如果你在函数声明中写了一个`this`表达式，而该函数本身又在某个方法中，这个`this`会被正确地解析为外部方法的接收器。

```typescript
class Nested {
  method() {
    fun function() {
      print this;
    }

    function();
  }
}

Nested().method();
```

这个程序应该打印“Nested instance”。为了决定给局部槽 0 取什么名字，编译器需要知道它正在编译一个函数还是方法声明，所以我们向 FunctionType 枚举中增加一个新的类型来区分方法。

_<u>compiler.c，在枚举 FunctionType 中添加代码：</u>_

```c
  TYPE_FUNCTION,
  // 新增部分开始
  TYPE_METHOD,
  // 新增部分结束
  TYPE_SCRIPT
```

当我们编译方法时，就使用这个类型。

_<u>compiler.c，在 method()方法中替换 1 行：</u>_

```c
  uint8_t constant = identifierConstant(&parser.previous);
  // 替换部分开始
  FunctionType type = TYPE_METHOD;
  // 替换部分结束
  function(type);
```

现在我们可以正确地编译对特殊的`this`变量的引用，编译器会发出正确的`OP_GET_LOCAL`来访问它。闭包甚至可以捕获`this`，并将接收器存储在上值中。非常酷。

除了在运行时，接收器实际上并不在槽 0*中*。解释器还没有履行它的承诺。下面是修复方法：

_<u>vm.c，在 callValue()方法中添加代码：</u>_

```c
      case OBJ_BOUND_METHOD: {
        ObjBoundMethod* bound = AS_BOUND_METHOD(callee);
        // 新增部分开始
        vm.stackTop[-argCount - 1] = bound->receiver;
        // 新增部分结束
        return call(bound->method, argCount);
      }
```

当某个方法被调用时，栈顶包含所有的参数，然后在这些参数下面是被调用方法的闭包。这就是新的 CallFrame 中槽 0 所在的位置。这一行代码会向该槽中插入接收器。例如，给出一个这样的方法调用：

```typescript
scone.topping("berries", "cream");
```

我们像这样计算存储接收器的槽：

![Skipping over the argument stack slots to find the slot containing the closure.](./closure-slot.png)

`-argCount`跳过传递的参数，而`-1`则是因为`stackTop`指向刚刚最后一个实用的栈槽而做的调整。

### 28.3.1 误用 this

我们的虚拟机现在支持用户正确地使用`this`，但我们还需要确保它能正确地处理用户误用`this`的情况。Lox 表示，如果`this`表达式出现在方法主体之外，就是一个编译错误。这两个错误的用法是编译器应该捕获的：

```typescript
print this; // At top level.

fun notMethod() {
  print this; // In a function.
}
```

那么编译器如何知道它是否在一个方法中呢？显而易见的答案是，查看当前 Compiler 的 FunctionType。我们在其中添加了一个新的枚举值来特殊对待方法。但是，这并不能正确地处理前面那个示例中的代码，即你在一个函数里面，而这个函数本身又嵌套在一个方法中。

我们可以尝试解析`this`，如果在外围的词法作用域中没有找到它，就报告一个错误。这样做是可行的，但需要我们修改一堆代码，因为如果没有找到声明，解析变量的代码现在会隐式地将其视为全局变量访问。

在下一章中，我们将需要关于最近邻外层类的信息。如果我们有这些信息，就可以在这里使用它来确定我们是否在某个方法中。因此，我们不妨让未来的自己生活得轻松一些，现在就把这种机制搞定。

_<u>compiler.c，在变量 current 后添加代码：</u>_

```c
Compiler* current = NULL;
// 新增部分开始
ClassCompiler* currentClass = NULL;
// 新增部分结束
static Chunk* currentChunk() {
```

这个模块变量指向一个表示当前正在编译的最内部类的结构体，新的类型看起来像这样：

_<u>compiler.c，在结构体 Compiler 后添加代码：</u>_

```c
} Compiler;
// 新增部分开始
typedef struct ClassCompiler {
  struct ClassCompiler* enclosing;
} ClassCompiler;
// 新增部分结束
Parser parser;
```

现在，我们只存储一个指向外层类（如果存在的话）的 ClassCompiler 的指针。将类声明嵌套在其它类的某个方法中并不常见，但 Lox 支持这种做法。就像 Compiler 结构体一样，这意味着 ClassCompiler 形成了一个链表，从当前正在被编译的最内层类一直到所有的外层类。

如果我们根本不在任何类的声明中，则模块变量`currentClass`是`NULL`。当编译器开始编译某个类时，它会将一个新的 ClassCompiler 推入这个隐式的链栈中。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  defineVariable(nameConstant);
  // 新增部分开始
  ClassCompiler classCompiler;
  classCompiler.enclosing = currentClass;
  currentClass = &classCompiler;
  // 新增部分结束
  namedVariable(className, false);
```

ClassCompiler 结构体的内存正好位于 C 栈中，这是通过使用递归下降来编写编译器而获得的便利。在类主体的最后，我们将该编译器从栈中弹出，并恢复外层的编译器。

_<u>compiler.c，在 classDeclaration()方法中添加代码：</u>_

```c
  emitByte(OP_POP);
  // 新增部分开始
  currentClass = currentClass->enclosing;
  // 新增部分结束
}
```

当最外层的类主体结束时，`enclosing`将是`NULL`，因此这里会将`currentClass`重置为`NULL`。因此，要想知道我们是否在一个类内部——也就是是否在一个方法中——我们只需要检查模块变量。

_<u>compiler.c，在 this\_()方法中添加代码：</u>_

```c
static void this_(bool canAssign) {
  // 新增部分开始
  if (currentClass == NULL) {
    error("Can't use 'this' outside of a class.");
    return;
  }
  // 新增部分结束
  variable(false);
```

有个这个，类之外的`this`就被正确地禁止了。现在我们的方法就像是面向对象意义上的*方法*。对接收器的访问使得它们可以影响调用方法的实例。我们正在走向成功！

## 28.4 实例初始化器

面向对象语言之所以将状态和行为结合在一起（范式的核心原则之一），是为了确保对象总是处于有效的、有意义的状态。当接触对象状态的唯一形式是通过它的方法时，这些方法可以确保不会出错[^9]。但前提是对象*已经*处于正常状态。那么，当对象第一次被创建时呢？

面向对象的语言通过构造函数确保新对象是被正确设置的，构造函数会生成一个新实例并初始化其状态。在 Lox 中，运行时会分配新的原始实例，而类可以声明一个初始化器来设置任何字段。初始化器的工作原理和普通方法差不多，只是做了一些调整：

1. 每当一个类的实例被创建时，运行时会自动调用初始化器方法。
2. 构建实例的调用方总是在初始化器完成后得到实例，而不管初始化器本身返回什么。初始化器方法不需要显式地返回`this`[^10]。
3. 事实上，初始化器根本不允许返回任何值，因为这些值无论如何都不会被看到。

既然我们支持方法，为了添加初始化式，我们只需要实现这三条特殊规则。我们按顺序进行。

### 28.4.1 调用初始化器

首先，在新实例上自动调用`init()`：

_<u>vm.c，在 callValue()方法中添加代码：</u>_

```c
        vm.stackTop[-argCount - 1] = OBJ_VAL(newInstance(klass));
        // 新增部分开始
        Value initializer;
        if (tableGet(&klass->methods, vm.initString,
                     &initializer)) {
          return call(AS_CLOSURE(initializer), argCount);
        }
        // 新增部分结束
        return true;
```

在运行时分配了新实例后，我们在类中寻找`init()`方法。如果找到了，就对其发起调用。这就为初始化器的闭包压入了一个新的 CallFrame。假设我们运行这个程序：

```typescript
class Brunch {
  init(food, drink) {}
}

Brunch("eggs", "coffee");
```

当 VM 执行对`Brunch()`的调用时，情况是这样的：

![The aligned stack windows for the Brunch() call and the corresponding init() method it forwards to.](./init-call-frame.png)

我们在调用该类时传入的所有参数都仍然在实例上方的栈中。`init()`方法的新 CallFrame 共享了这个栈窗口，因此这些参数会隐式地转发给初始化器。

Lox 并不要求类定义初始化器。如果省略，运行时只是简单地返回新的未初始化的实例。然而，如果没有`init()`方法，那么在创建实例时向类传递参数就没有意义了。我们将其当作一个错误。

_<u>vm.c，在 callValue()方法中添加代码：</u>_

```c
          return call(AS_CLOSURE(initializer), argCount);
        // 新增部分开始
        } else if (argCount != 0) {
          runtimeError("Expected 0 arguments but got %d.",
                       argCount);
          return false;
        // 新增部分结束
        }
```

当类*确实*提供了初始化器时，我们还需要确保传入参数的数量与初始化器的元数匹配。幸运的是，`call()`辅助函数已经为我们做到了这一点。

为了调用初始化器，运行时会按名称查找`init()`方法。我们希望这个过程是快速的，因为这在每次构造实例时都会发生。这意味着我们可以很好地利用已经实现的字符串驻留。为此，VM 为“init”创建了一个 ObjString 并重用它。这个字符串就位于 VM 结构体中。

_<u>vm.h，在结构体 VM 中添加代码：</u>_

```c
  Table strings;
  // 新增部分开始
  ObjString* initString;
  // 新增部分结束
  ObjUpvalue* openUpvalues;
```

当虚拟机启动时，我们创建并驻留该字符串。

_<u>vm.c，在 initVM()方法中添加代码：</u>_

```c
  initTable(&vm.strings);
  // 新增部分开始
  vm.initString = copyString("init", 4);
  // 新增部分结束
  defineNative("clock", clockNative);
```

我们希望它一直存在，因此 GC 将其视为根。

_<u>memory.c，在 markRoots()方法中添加代码：</u>_

```c
  markCompilerRoots();
  // 新增部分开始
  markObject((Obj*)vm.initString);
  // 新增部分结束
}
```

仔细观察。看到什么潜藏的 bug 了吗？没有吗？这是一个微妙的问题。垃圾回收器现在读取`vm.initString`。这个字段是由调用`copyString()`的结果来初始化的。但复制字符串会分配内存，这可能会触发 GC。如果回收器在错误的时间运行时，它就会在`vm.initString`初始化之前读取它。所以，我们首先将这个字段清零。

_<u>vm.c，在 initVM()方法中添加代码：</u>_

```c
  initTable(&vm.strings);
  // 新增部分开始
  vm.initString = NULL;
  // 新增部分结束
  vm.initString = copyString("init", 4);
```

我们在 VM 关闭时清除指针，因为下一行会释放它。

_<u>vm.c，在 freeVM()方法中添加代码：</u>_

```c
  freeTable(&vm.strings);
  // 新增部分开始
  vm.initString = NULL;
  // 新增部分结束
  freeObjects();
```

好，这样我们就可以调用初始化器了。

### 28.4.2 返回值的初始化器

下一步是确保用初始化器构造类实例时，总是返回新的实例，而不是`nil`或初始化式返回的任何内容。现在，如果某个类定义了一个初始化器，那么当构建一个实例时，虚拟机会把对该初始化器的调用压入 CallFrame 栈。然后，它就可以自动被执行了。

只要初始化器方法返回，用户对类的创建实例的调用就会结束，并把初始化器方法放入栈中的值遗留在那里。这意味着，除非用户特意在初始化器的末尾写上`return this;`，否则不会出现任何实例。不太有用。

为了解决这个问题，每当前端编译初始化器方法时，都会在主体末尾生成一个特殊的字节码，以便从方法中返回`this`，而不是大多数函数通常会隐式返回的`nil`。为了做到这一点，编译器需要真正知道它在何时编译一个初始化器。我们通过检查正在编译的方法名称是否为“init”进行确认。

_<u>compiler.c，在 method()方法中添加代码：</u>_

```c
  FunctionType type = TYPE_METHOD;
  // 新增部分开始
  if (parser.previous.length == 4 &&
      memcmp(parser.previous.start, "init", 4) == 0) {
    type = TYPE_INITIALIZER;
  }
  // 新增部分结束
  function(type);
```

我们定义一个新的函数类型来区分初始化器和其它方法。

_<u>compiler.c，在枚举 FunctionType 中添加代码：</u>_

```c
  TYPE_FUNCTION,
  // 新增部分开始
  TYPE_INITIALIZER,
  // 新增部分结束
  TYPE_METHOD,
```

每当编译器准备在主体末尾发出隐式返回指令时，我们会检查其类型以决定是否插入初始化器的特定行为。

_<u>compiler.c，在 emitReturn()方法中替换 1 行：</u>_

```c
static void emitReturn() {
  // 新增部分开始
  if (current->type == TYPE_INITIALIZER) {
    emitBytes(OP_GET_LOCAL, 0);
  } else {
    emitByte(OP_NIL);
  }
  // 新增部分结束
  emitByte(OP_RETURN);
```

在初始化器中，我们不再在返回前将`nil`压入栈中，而是加载包含实例的槽 0。在编译不带值的`return`语句时，这个`emitReturn()`函数也会被调用，因此它也能正确处理用户在初始化器中提前返回的情况。

### 28.4.3 初始化器中的错误返回

最后一步，也就是我们的初始化器特性列表中的最后一条，是让试图从初始化器中返回任何*其它*值的行为成为错误。既然编译器跟踪了方法类型，这就很简单了。

_<u>compiler.c，在 returnStatement()方法中添加代码：</u>_

```c
  if (match(TOKEN_SEMICOLON)) {
    emitReturn();
  } else {
    // 新增部分开始
    if (current->type == TYPE_INITIALIZER) {
      error("Can't return a value from an initializer.");
    }
    // 新增部分结束
    expression();
```

如果初始化式中的`return`语句中有值，则报告一个错误。我们仍然会在后面编译这个值，这样编译器就不会因为被后面的表达式迷惑而报告一堆级联错误。

除了继承（我们很快会讲到），我们在 clox 中有了一个功能相当齐全的类系统。

```typescript
class CoffeeMaker {
  init(coffee) {
    this.coffee = coffee;
  }

  brew() {
    print "Enjoy your cup of " + this.coffee;

    // No reusing the grounds!
    this.coffee = nil;
  }
}

var maker = CoffeeMaker("coffee and chicory");
maker.brew();
```

对于一个可以放在旧软盘上的 C 程序来说，这真是太神奇了[^11]。

## 28.5 优化调用

我们的虚拟机正确地实现了语言中方法调用和初始化器的语义。我们可以到此为止。但是，我们从头开始构建 Lox 的第二个完整实现的主要原因是，它的执行速度比我们的旧 Java 解释器要更快。现在，即使在 clox 中，方法调用也很慢。

Lox 的语义将方法调用定义为两个操作——访问方法，然后调用结果。我们的虚拟机必须支持这些单独的操作，因为用户*可以*将它们区分对待。你可以在不调用方法的情况下访问它，接着稍后再调用已绑定的方法。我们目前还未实现的一切内容，都是不必要的。

但是，*总是*将它们作为两个单独的操作来执行会产生很大的成本。每次 Lox 程序访问并调用一个方法时，运行时堆都会分配一个新的 ObjBoundMethod，初始化其字段，然后再把这些字段拉出来。之后，GC 必须花时间释放所有这些临时绑定的方法。

大多数情况下，Lox 程序会访问一个方法并立即调用它。已绑定方法是由一条字节码指令创建的，然后由下一条指令使用。事实上，它是如此直接，以至于编译器甚至可以从文本上看到它的发生——一个带点的属性访问后面跟着一个左括号，很可能是一个方法调用。

因为我们可以在编译时识别这对操作，所以我们有机会发出一条新的特殊指令，执行优化过的方法调用[^12]。

我们从编译点属性表达式的函数中开始。

_<u>compiler.c，在 dot()方法中添加代码：</u>_

```c
  if (canAssign && match(TOKEN_EQUAL)) {
    expression();
    emitBytes(OP_SET_PROPERTY, name);
  // 新增部分开始
  } else if (match(TOKEN_LEFT_PAREN)) {
    uint8_t argCount = argumentList();
    emitBytes(OP_INVOKE, name);
    emitByte(argCount);
  // 新增部分结束
  } else {
```

在编译器解析属性名称之后，我们寻找一个左括号。如果匹配到了，则切换到一个新的代码路径。在那里，我们会像编译调用表达式一样来编译参数列表。然后我们发出一条新的`OP_INVOKE`指令。它需要两个操作数：

1. 属性名称在常量表中的索引。
2. 传递给方法的参数数量。

换句话说，这条指令结合了它所替换的`OP_GET_PROPERTY` 和 `OP_CALL`指令的操作数，按顺序排列。它实际上是这两条指令的融合。让我们来定义它。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_CALL,
  // 新增部分开始
  OP_INVOKE,
  // 新增部分结束
  OP_CLOSURE,
```

将其添加到反汇编程序：

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
    case OP_CALL:
      return byteInstruction("OP_CALL", chunk, offset);
    // 新增部分开始
    case OP_INVOKE:
      return invokeInstruction("OP_INVOKE", chunk, offset);
    // 新增部分结束
    case OP_CLOSURE: {
```

这是一种新的、特殊的指令格式，所以需要一些自定义的反汇编逻辑。

_<u>debug.c，在 constantInstruction()方法后添加代码：</u>_

```c
static int invokeInstruction(const char* name, Chunk* chunk,
                                int offset) {
  uint8_t constant = chunk->code[offset + 1];
  uint8_t argCount = chunk->code[offset + 2];
  printf("%-16s (%d args) %4d '", name, argCount, constant);
  printValue(chunk->constants.values[constant]);
  printf("'\n");
  return offset + 3;
}
```

我们读取两个操作数，然后打印出方法名和参数数量。解释器的字节码调度循环中才是真正的行动开始的地方。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_INVOKE: {
        ObjString* method = READ_STRING();
        int argCount = READ_BYTE();
        if (!invoke(method, argCount)) {
          return INTERPRET_RUNTIME_ERROR;
        }
        frame = &vm.frames[vm.frameCount - 1];
        break;
      }
      // 新增部分结束
      case OP_CLOSURE: {
```

大部分工作都发生在`invoke()`中，我们会讲到这一点。在这里，我们从第一个操作数中查找方法名称，接着读取参数数量操作数。然后我们交给`invoke()`来完成繁重的工作。如果调用成功，该函数会返回`true`。像往常一样，返回`false`意味着发生了运行时错误。我们在这里进行检查，如果灾难发生就中止解释器的运行。

最后，假如调用成功，那么栈中会有一个新的 CallFrame，所以我们刷新`frame`中缓存的当前帧副本。

有趣的部分在这里：

_<u>vm.c，在 callValue()方法后添加代码：</u>_

```c
static bool invoke(ObjString* name, int argCount) {
  Value receiver = peek(argCount);
  ObjInstance* instance = AS_INSTANCE(receiver);
  return invokeFromClass(instance->klass, name, argCount);
}
```

首先我们从栈中抓取接收器。传递给方法的参数在栈中位于接收器上方，因此我们要查看从上往下跳过多个位置的栈槽。然后，将对象转换成实例并对其调用方法就很简单了。

它确实假定了对象*是*一个实例。与`OP_GET_PROPERTY`指令一样，我们也需要处理这种情况：用户错误地试图在一个错误类型的值上调用一个方法。

_<u>vm.c，在 invoke()方法中添加代码：</u>_

```c
  Value receiver = peek(argCount);
  // 新增部分开始
  if (!IS_INSTANCE(receiver)) {
    runtimeError("Only instances have methods.");
    return false;
  }
  // 新增部分结束
  ObjInstance* instance = AS_INSTANCE(receiver);
```

这是一个运行时错误，所以我们报告错误并退出。否则，我们获取实例的类并跳转到另一个新的工具函数[^13]：

_<u>vm.c，在 callValue()方法后添加代码：</u>_

```c
static bool invokeFromClass(ObjClass* klass, ObjString* name,
                            int argCount) {
  Value method;
  if (!tableGet(&klass->methods, name, &method)) {
    runtimeError("Undefined property '%s'.", name->chars);
    return false;
  }
  return call(AS_CLOSURE(method), argCount);
}
```

这个函数按顺序结合了 VM 中实现`OP_GET_PROPERTY` 和`OP_CALL`指令的逻辑。首先，我们在类的方法表中按名称查找方法。如果没有找到，则报告错误并退出。

否则，我们获取方法闭包并将对它的调用压入 CallFrame 栈。我们不需要在堆上分配并初始化 ObjBoundMethod。实际上，我们甚至不需要在栈上做什么操作。接收器和方法参数已经位于它们应在的位置了[^14]。

如果你现在启动虚拟机并运行一个调用方法的小程序，你应该会看到和以前完全相同的行为。但是，如果我们的工作做得好，*性能*应该会大大提高。我写了一个小小的微基准测试，执行每批 10000 次方法调用。然后测试在 10 秒钟内可以执行多少个批次。在我的电脑上，如果没有新的`OP_INVOKE`指令，它完成了 1089 个批次。通过新的优化，它在相同的时间中完成了 8324 个批次。速度提升了 7.6 倍，对于编程语言优化来说，这是一个巨大的改进[^15]。

![Bar chart comparing the two benchmark results.](./benchmark.png)

### 28.5.1 调用字段

优化的基本信条是：“你不应该破坏正确性”。用户喜欢语言实现能更快地给出答案，但前提是这个答案是正确的[^16]。唉，我们这个快速的方法调用实现并没有坚持这一原则：

```typescript
class Oops {
  init() {
    fun f() {
      print "not a method";
    }

    this.field = f;
  }
}

var oops = Oops();
oops.field();
```

最后一行看起来像是一个方法调用。编译器认为它是，并尽职尽责地为它发出一条`OP_INVOKE`指令。然而，事实并非如此。实际发生的是一个*字段*访问，它会返回一个函数，然后该函数被调用。现在，我们的虚拟机没有正确地执行它，而在找不到名为“field”的方法时报告一个运行时错误。

之前，当我实现`OP_GET_PROPERTY`时，我们同时处理了字段和方法的访问。为了消除这个新 bug，我们需要对`OP_INVOKE`做同样的事情。

_<u>vm.c，在 invoke()方法中添加代码：</u>_

```c
  ObjInstance* instance = AS_INSTANCE(receiver);
  // 新增部分开始
  Value value;
  if (tableGet(&instance->fields, name, &value)) {
    vm.stackTop[-argCount - 1] = value;
    return callValue(value, argCount);
  }
  // 新增部分结束
  return invokeFromClass(instance->klass, name, argCount);
```

非常简单的解决方法。在查找实例类上的方法之前，我们先查找具有相同名称的字段。如果我们找到一个字段，那我们就将其存储在栈中代替接收器，放在参数列表*下面*。这就是`OP_GET_PROPERTY`的行为方式，因为后者的指令执行时机是在随后括号内的参数列表被求值之前。

然后，我们尝试调用该字段的值（就像它如期望的那样是可调用的）。`callValue()`辅助函数会检查值的类型并适当地调用它，如果该字段的值不是像闭包这样的可调用类型，则报告运行时错误。

这就是使我们的优化完全安全的全部工作。不幸的是，我们确实牺牲了一点性能。但有时候这是你必须要付出的代价。如果语言不允许出现一些令人讨厌的极端情况，你可能会对某些*可做*的优化感到沮丧。但是，作为语言实现者，我们必须玩我们被赋予的游戏[^17]。

我们在这里编写的代码遵循一个优化中的典型模式：

1. 识别出对性能至关重要的常见操作或操作序列。在本例中，它是一个方法访问后跟一个调用。
2. 添加该模式的优化实现。也就是我们的`OP_INVOKE`指令。
3. 用一些条件逻辑来验收是否适用该模式，从而保护优化后的代码。如果适用，就走捷径。否则，就退回到较慢但更稳健的非优化行为。在这里，意味着要检查我们是否真的在调用一个方法而不是访问一个字段。

随着你的语言工作从让语言实现完全工作到让它更快工作，你会发现自己花费了越来越多的时间来寻找这样的模式，并为它们添加保护性优化。全职虚拟机工程师的大部分职业生涯都是在这个循环中度过的。

但是我们可以到此为止了。有了这些，clox 现在支持面向对象编程语言的大部分特性，而且具有不错的性能。

[^1]: 我们对闭包做了类似的操作。`OP_CLOSURE`指令需要知道每个捕获的上值的类型和索引。我们在主`OP_CLOSURE`指令之后使用一系列伪指令对其进行编码——基本上是一个可变数量的操作数。VM 在解释`OP_CLOSURE`指令时立即处理所有这些额外的字节。<BR>这里我们的方法有所不同，因为从 VM 的角度看，定义方法的每条指令都是一个独立的操作。两种方法都可行。可变大小的伪指令可能稍微快一点，但是类声明很少在热循环中出现，所以没有太大关系。
[^2]: 如果 Lox 只支持在顶层声明类，那么虚拟机就可以假定任何类都可以直接从全局变量表中查找出来。然而，由于我们支持局部类，所以我们也需要处理这种情况。
[^3]: 前面对`defineVariable()`的调用将类弹出栈，因此调用`namedVariable()`将其加载会栈中似乎有点愚蠢。为什么不一开始就把它留在栈上呢？我们可以这样做，但在下一章中，我们将在这两个调用之间插入代码，以支持继承。到那时，如果类不在栈上会更容易。
[^4]: 虚拟机相信它执行的指令是有效的，因为将代码送到字节码解释器的唯一途径是通过 clox 自己的编译器。许多字节码虚拟机，如 JVM 和 CPython，支持执行单独编译好的字节码。这就导致了一个不同的安全问题。恶意编写的字节码可能会导致虚拟机崩溃，甚至更糟。<BR>为了防止这种情况，JVM 在执行任何加载的代码之前都会进行字节码验证。CPython 说，由用户来确保他们运行的任何字节码都是安全的。
[^5]: 我从 CPython 中借鉴了“bound method”这个名字。Python 跟 Lox 这里的行为很类似，我通过它的实现获得灵感。
[^6]: 跟踪方法的闭包实际上是没有必要的。接收器是一个 ObjInstance，它有一个指向其 ObjClass 的指针，而 ObjClass 有一个存储所有方法的表。但让 ObjBoundMethod 依赖于它，我觉得在某种程度上是值得怀疑的。
[^7]: 已绑定方法是第一类值，所以他们可以把它存储在变量中，传递给函数，以及用它做“值”可做的事情。
[^8]: 解析器函数名称后面的下划线是因为`this`是 C++中的一个保留字，我们支持将 clox 编译为 C++。
[^9]: 当然，Lox 确实允许外部代码之间访问和修改一个实例的字段，而不需要通过实例的方法。这与 Ruby 和 Smalltalk 不同，后者将状态完全封装在对象中。我们的玩具式脚本语言，唉，不那么有原则。
[^10]: 就好像初始化器被隐式地包装在这样的一段代码中：<BR>![image-20220929122619800](./image-20220929122619800.png)<BR>注意`init()`返回的值是如何被丢弃的。
[^11]: 我承认，“软盘”对于当前一代程序员来说，可能不再是一个有用的大小参考。也许我应该说“几条推特”之类的。
[^12]: 如果你花足够的时间观察字节码虚拟机的运行，你会发现它经常一次次地执行同一系列的字节码指令。一个经典的优化技术是定义新的单条指令，称为**超级指令**，它将这些指令融合到具有与整个序列相同行为的单一指令。<BR>在字节码解释器中，最大的性能消耗之一是每个指令的解码和调度的开销。将几个指令融合在一起可以消除其中的一些问题。<BR>难点在于确定*哪些*指令序列足够常见，并可以从这种优化中受益。每条新的超级指令都要求有一个操作码供自己使用，而这些操作码的数量是有限的。如果添加太多，你就需要对操作码进行更长的编码，这就增加了代码的大小，使得所有指令的解码速度变慢。
[^13]: 你应该可以猜到，我们将这段代码拆分成一个单独的函数，是因为我们稍后会复用它——`super`调用中。
[^14]: 这就是我们使用栈槽 0 来存储接收器的一个主要原因——调用方就是这样组织方法调用栈的。高效的调用约定是字节码虚拟机性能故事的重要组成部分。
[^15]: 我们不应该过于自信。这种性能优化是相对于我们自己未优化的方法调用实现而言的，而那种方法调用实现相当缓慢。为每个方法调用都进行堆分配不会赢得任何比赛。
[^16]: 在有些情况下，当程序偶尔返回错误的答案，以换取显著加快的运行速度或更好的性能边界，用户可能也是满意的。这些就是**[蒙特卡洛算法](https://en.wikipedia.org/wiki/Monte_Carlo_algorithm)**的领域。对于某些用例来说，这是一个很好的权衡。<BR>不过，重要的是，由用户选择使用这些算法中的某一种。我们这些语言实现者不能单方面地决定牺牲程序的正确性。
[^17]: 作为语言*设计者*，我们的角色非常不同。如果我们确实控制了语言本身，我们有时可能会选择限制或改变语言的方式来实现优化。用户想要有表达力的语言，但他们也想要快速实现。有时，如果牺牲一点功能来获得完美回报是很好的语言设计。

---

## 习题

1. 哈希表中查找类的`init()`方法是常量时间复杂度，但仍然相当慢。实现一些更快的方法。写一个基准测试并度量性能差异。

2. 在像 Lox 这样的动态类型语言中，程序执行过程中的同样的一个调用可能会调用多个类上的多个方法。即便如此，在实践中，大多数情况下某个调用在运行期间会执行同一个类上的同一个方法。大多数调用实际上不是多态的，即使语言说它们是多态的。

   高级的语言实现是如何基于这一观察进行优化的？

3. 在解释`OP_INVOKE`指令时，虚拟机必须执行两次哈希表查询。首先，它要查找可能会遮蔽方法的字段，只有这一步失败时才会查找方法。前一个检查很少有用——大多数字段都不包含函数。但它是*必要*的，因为语言要求字段和方法通过同样的语法来访问，并且字段会遮蔽方法。

   这是一种影响实现性能的语言选择。这是个正确的选择吗？如果 Lox 是你的语言，你会怎么做？

---

## 设计笔记：新奇性预算

我还记得我第一次在 TRS-8 上写了一个小小的 BASIC 程序，让电脑做了一些它以前没有做过的事。这感觉就像是一种超能力。我第一次组装出一个解析器和解释器，能够让我使用*自己的语言*写一个小程序，让计算机做了一件事，就像某种更高阶的超能力。这种感觉过去是美妙的，现在仍然是。

我意识到，我可以设计一种外观和行为都由我选择的语言。就好像我一直在一所要求穿制服的私立学校上学，然后有一天转到了一所公立学校，在那里我想穿什么就穿什么。我不要使用大括号来表示代码块？我可以用等号以外的符号进行赋值？我可以实现没有类的对象？多重继承和多分派？根据元数进行静态重载的动态语言？

很自然地，我接受了这种自由。我做了最古怪、最随意的语言设计决策。撇号表示泛型，参数之间不使用逗号，在运行时可能会失败的重载解析。我做了一些不同的事情，只是为了与众不同。

这是一个非常有趣的体验，我强烈推荐。我们需要更多奇怪、前卫的编程语言。我希望看到更多的艺术语言。有时候我还会做一些奇怪的玩具语言来玩。

_然而_，如果你的目标是成功，而“成功”被定义为大量的用户，那么你的优先事项必然是不同的。在这种情况下，你的首要目标是让尽可能多的人记住你的语言。这*真的*很难。要将一种语言的语法和语义从计算机转移到数万亿的神经元中，需要付出大量的努力。

程序员对他们的时间自然是保守的，对于哪些语言值得上传到他们的湿件（即大脑）中。他们不想把时间浪费在一门最终对他们没有用处的语言上。因此，作为语言设计者，你的目标是为他们提供尽可能多的语言能力，并尽可能地减少所需的学习。

一个自然的方法是*简单化*。你的语言拥有的概念和功能越少，你需要学习的东西就越少。这就是小型脚本语言虽然不像大型工业语言那样强大却经常获得成功的原因之一——它们更容易上手，而且它们一旦进入了人们的大脑，用户就想继续使用它们[^18]。

简单化的问题在于，简单地删减功能通常会牺牲功能和表现力。找到超越其重量的功能是一门艺术，但通常小型语言做得更少，

还有另一种方法可以避免这个问题。诀窍是要意识到，用户不必将你的整个语言都装进他们的脑子里，只需要把他们*还没有的部分*装进去就行了。正如我在之前的设计笔记中提到的，学习是转移他们已知内容与需要知道的内容之间的差量。

你的语言的许多潜在用户已经了解了一些其它的编程语言。当涉及到学习时，你的语言与这些语言共享的任何功能基本上都是“免费”的。它已经在用户的头脑中了，他们只需要认识到你的语言也做了同样的事情。

换句话说，*熟悉度*是降低语言采用成本的另一个关键工具。当然，如果你将这一属性完全最大化，最终的结果就是一门与某些现有语言完全相同的语言。这不是成功的秘诀，因为在这一点上，用户根本没有切换到你的语言的动力。

所以你确实需要提供一些令人信服的差异。某些事情你的语言可以做到，而其它语言做不到，或者至少做得不如你的好。我相信这是语言设计的基本平衡行为之一：与其它语言的相似性降低了学习成本，而差异性提高了令人信服的优势。

我认为这种平衡就像是**新奇性预算**，或者像 Steve Klabnik 所说，是一种“[陌生感预算](https://words.steveklabnik.com/the-language-strangeness-budget)”[^19]。用户对于学习新语言时愿意接受的新知识的总量有一个较低的阈值。如果超过这个值，他们就不会来学习了。

任何时候，你为你的语言添加了其它语言没有的新东西，或者你的语言以不同的方式做了其它语言做的事情，你都会花费一下预算。这没关系——你*需要*花费预算来使你的语言更具有吸引力。但你的目标是明智地使用这些预算。对于每一种特性或差异，问问你自己它为你的语言增加了多少引人注目的能力，然后严格评估它是否值得。这种改变是否有价值，而且值得你花费一些新奇性预算？

在实践中，我发现这意味着你最终会在语法上相当保守，而在语义上更加大胆。虽然换一套新衣服很有趣，但把花括号换成其它代码块分隔符并不可能给语言增加多少真正的能力，但它确实会花费一些新奇性。语法上的差异很难承载它们的重量。

另一方面，新的语义可以显著增加语言的能力。多分派、mixins、traits、反射、依赖类型、运行时元编程等可以从根本上提升用户使用语言的能力。

唉，这样的保守并不像直接改变一切那样有趣。但是否追求主流的成功，首先取决于你。我们不需要都成为电台欢迎的流行乐队。如果你想让你的语言像自由爵士或嗡鸣金属那样，并且对比较较小（但可能更忠实）的观众数量感到满意，那就去做吧。

[^18]: 特别的，这是动态类型语言的一大优势。静态语言需要你学习两种语言——运行时语义和静态类型系统，然后才能让计算机做一些事情。动态语言只要求你学习前者。<BR>最终，程序变得足够大，静态分析的价值足以抵扣学习第二门静态语言的努力，但其价值在一开始并不那么明显。
[^19]: 心理学中的一个相关概念是[性格信用](https://en.wikipedia.org/wiki/Idiosyncrasy_credit)，即社会上的其他人会给予你有限的与社会规范的偏离。你通过融入并做群体内的事情来获得信用，然后你可以把这些信用花费在那些可能会引人侧目的古怪活动上。换句话说，证明你是“好人之一”，让你有资格展示自己怪异的一面，但只能到此为止。
