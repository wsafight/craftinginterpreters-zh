---
title: 27. 类与实例
description: Classes and Instances
---

> 太在意物品会毁了你。只是——如果你足够在意一件物品，它就会有自己的生命，不是吗？而物品——美丽的物品——的全部意义不就是它们将你与某种更广阔的美联系起来吗？
>
> ​ —— Donna Tartt, _The Goldfinch_

clox 中需要实现的最后一个领域是面向对象编程。OOP 是一堆交织在一起的特性：类、实例、字段、方法、初始化式和继承[^1]。使用相对高级的 Java，我们可以把这些内容都装进两章中。现在我们用 C 语言编写代码，感觉就像用牙签搭建埃菲尔铁塔的模型，我们将用三章的篇幅来涵盖这些内容。这使得我们可以悠闲地漫步在实现中。在经历了[闭包](../../closures/readme/)和[垃圾回收器](../../garbage-collection/readme/)这样艰苦的章节之后，你赢得了休息的机会。事实上，从这里开始，这本书都是很容易的。

在本章中，我们会介绍前三个特性：类、实例和字段。这就是面向对象中表现出状态的一面。然后在接下来的两章中，我们会对这些对象挂上行为和代码重用能力。

## 27.1 Class 对象

在一门基于类的面向对象的语言中，一切都从类开始。它们定义了程序中存在什么类型的对象，并且它们也是用来生产新实例的工厂。自下向上，我们将从它们的运行时表示形式开始，然后将其挂接到语言中。

至此，我们已经非常熟悉向 VM 添加新对象类型的过程了。我们从一个结构体开始。

_<u>object.h，在结构体 ObjClosure 后添加代码：</u>_

```c
} ObjClosure;
// 新增部分开始
typedef struct {
  Obj obj;
  ObjString* name;
} ObjClass;
// 新增部分结束
ObjClosure* newClosure(ObjFunction* function);
```

在 Obj 头文件之后，我们存储了类的名称。对于用户的程序来说，这一信息并不是严格需要的，但是它让我们可以在运行时显示名称，例如堆栈跟踪。

新类型需要在 ObjType 枚举中有一个对应的项。

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
typedef enum {
  // 新增部分开始
  OBJ_CLASS,
  // 新增部分结束
  OBJ_CLOSURE,
```

而该类型会有一组对应的宏。首先，用于测试对象的类型：

_<u>object.h，添加代码：</u>_

```c
#define OBJ_TYPE(value)        (AS_OBJ(value)->type)
// 新增部分开始
#define IS_CLASS(value)        isObjType(value, OBJ_CLASS)
// 新增部分结束
#define IS_CLOSURE(value)      isObjType(value, OBJ_CLOSURE)
```

然后是用于将一个 Value 转换为一个 ObjClass 指针：

_<u>object.h，添加代码：</u>_

```c
#define IS_STRING(value)       isObjType(value, OBJ_STRING)
// 新增部分开始
#define AS_CLASS(value)        ((ObjClass*)AS_OBJ(value))
// 新增部分结束
#define AS_CLOSURE(value)      ((ObjClosure*)AS_OBJ(value))
```

VM 使用这个函数创建新的类对象：

_<u>object.h，在结构体 ObjClass 后添加代码：</u>_

```c
} ObjClass;
// 新增部分开始
ObjClass* newClass(ObjString* name);
// 新增部分结束
ObjClosure* newClosure(ObjFunction* function);
```

实现在这里：

_<u>object.c，在 allocateObject()方法后添加代码：</u>_

```c
ObjClass* newClass(ObjString* name) {
  ObjClass* klass = ALLOCATE_OBJ(ObjClass, OBJ_CLASS);
  klass->name = name;
  return klass;
}
```

几乎都是模板代码。它接受并保存字符串形式的类名。每当用户声明一个新类时，VM 会创建一个新的 ObjClass 结构体来表示它[^2]。

当 VM 不再需要某个类时，这样释放它：

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
  switch (object->type) {
    // 新增部分开始
    case OBJ_CLASS: {
      FREE(ObjClass, object);
      break;
    }
    // 新增部分结束
    case OBJ_CLOSURE: {
```

我们现在有一个内存管理器，所以我们也需要支持通过类对象进行跟踪。

_<u>memory.c，在 blackenObject()方法中添加代码：</u>_

```c
  switch (object->type) {
    // 新增部分开始
    case OBJ_CLASS: {
      ObjClass* klass = (ObjClass*)object;
      markObject((Obj*)klass->name);
      break;
    }
    // 新增部分结束
    case OBJ_CLOSURE: {
```

当 GC 到达一个类对象时，它会标记该类的名称，以保持该字符串也能存活。

VM 可以对类执行的最后一个操作是打印它。

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
  switch (OBJ_TYPE(value)) {
    // 新增部分开始
    case OBJ_CLASS:
      printf("%s", AS_CLASS(value)->name->chars);
      break;
    // 新增部分结束
    case OBJ_CLOSURE:
```

类只是简单地说出它的名称。

## 27.2 类声明

有了运行时表示形式，我们就可以向语言中添加对类的支持了。接下来，我们进入语法分析部分。

_<u>compiler.c，在 declaration()方法中替换 1 行：</u>_

```c
static void declaration() {
  // 替换部分开始
  if (match(TOKEN_CLASS)) {
    classDeclaration();
  } else if (match(TOKEN_FUN)) {
  // 替换部分结束
    funDeclaration();
```

类声明是语句，解释器通过前面的`class`关键字识别声明语句。剩下部分的编译工作在这里进行：

_<u>compiler.c，在 function()方法后添加代码：</u>_

```c
static void classDeclaration() {
  consume(TOKEN_IDENTIFIER, "Expect class name.");
  uint8_t nameConstant = identifierConstant(&parser.previous);
  declareVariable();

  emitBytes(OP_CLASS, nameConstant);
  defineVariable(nameConstant);

  consume(TOKEN_LEFT_BRACE, "Expect '{' before class body.");
  consume(TOKEN_RIGHT_BRACE, "Expect '}' after class body.");
}
```

紧跟在`class`关键字之后的是类名。我们将这个标识符作为字符串添加到外围函数的常量表中。正如你刚才看到的，打印一个类会显示它的名称，所以编译器需要把这个名称字符串放在运行时可以找到的地方。常量表就是实现这一目的的方法。

类名也被用来将类对象与一个同名变量绑定。因此，我们在使用完它的词法标识后，马上用这个标识符声明一个变量[^3]。

接下来我们发出一条新指令，在运行时实际创建类对象。该指令以类名的常量表索引作为操作数。

在此之后，但是在编译类主体之前，我们使用类名定义变量。*声明*变量会将其添加到作用域中，但请回想一下[前一章](../../local-variables/readme/)的内容，在定义变量之前我们不能使用它。对于类，我们在解析主体之前定义变量。这样，用户就可以在类自己的方法主体中引用类本身。这对于产生类的新实例的工厂方法等场景来说是很有用的。

最后，我们编译主体。我们现在还没有方法，所以现在它只是一对空的大括号。Lox 不要求在类中声明字段，因此我们目前已经完成了主体（和解析器）的工作。

编译器会发出一条新指令，所以我们来定义它。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_RETURN,
  // 新增部分开始
  OP_CLASS,
  // 新增部分结束
} OpCode;
```

然后将其添加到反汇编程序中：

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
    case OP_RETURN:
      return simpleInstruction("OP_RETURN", offset);
    // 新增部分开始
    case OP_CLASS:
      return constantInstruction("OP_CLASS", chunk, offset);
    // 新增部分结束
    default:
```

对于这样一个看起来很大的特性，解释器支持是最小的。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        break;
      }
      // 新增部分开始
      case OP_CLASS:
        push(OBJ_VAL(newClass(READ_STRING())));
        break;
      // 新增部分结束
    }
```

我们从常量表中加载类名的字符串，并将其传递给`newClass()`。这将创建一个具有给定名称的新类对象。我们把它推入栈中就可以了。如果该类被绑定到一个全局变量上，那么编译器对`defineVariable()`的调用就会生成字节码，将该对象从栈中存储到全局变量表。否则，它就正好位于栈中新的局部变量所在的位置[^4]。

好了，我们的虚拟机现在支持类了。你可以运行这段代码：

```c
class Brioche {}
print Brioche;
```

不幸的是，打印是你对类所能做的全部事情，所以接下来是让它们更有用。

## 27.3 类的实例

类在一门语言中主要有两个作用：

- **它们是你创建新实例的方式**。有时这会涉及到`new`关键字，有时则是对类对象的方法调用，但是你通常会以某种方式通过类的名称来获得一个新的实例。
- **它们包含方法**。这些方法定义了类的所有实例的行为方式。

我们要到下一章才会讲到方法，所以我们现在只关心第一部分。在类能够创建实例之前，我们需要为它们提供一个表示形式。

_<u>object.h，在结构体 ObjClass 后添加代码：</u>_

```c
} ObjClass;
// 新增部分开始
typedef struct {
  Obj obj;
  ObjClass* klass;
  Table fields;
} ObjInstance;
// 新增部分结束
ObjClass* newClass(ObjString* name);
```

实例知道它们的类——每个实例都有一个指向它所属类的指针。在本章中我们不会过多地使用它，但是等我们添加方法时，它将会变得非常重要。

对本章来说，更重要的是实例如何存储它们的状态。Lox 允许用户在运行时自由地向实例中添加字段。这意味着我们需要一种可以增长的存储机制。我们可以使用动态数组，但我们也希望尽可能快地按名称查找字段。有一种数据结构非常适合于按名称快速访问一组值——甚至更方便的是——我们已经实现了它。每个实例都使用哈希表来存储其字段[^5]。

我们只需要添加一个头文件引入，就可以了。

_<u>object.h，添加代码：</u>_

```c
#include "chunk.h"
// 新增部分开始
#include "table.h"
// 新增部分结束
#include "value.h"
```

新结构体有新的对象类型。

_<u>object.h，在枚举 ObjType 中添加代码：</u>_

```c
  OBJ_FUNCTION,
  // 新增部分开始
  OBJ_INSTANCE,
  // 新增部分结束
  OBJ_NATIVE,
```

这里我想放慢一点速度，因为 Lox*语言*中的“type”概念和*虚拟机实现*中的“type”概念是相互抵触的，可能会造成混淆。在生成 clox 的 C 语言代码中，有许多不同类型的 Obj——ObjString、ObjClosure 等等。每个都有自己的内部表示和语义。

在 Lox*语言*中，用户可以定义自己的类——比如 Cake 和 Pie——然后创建这些类的实例。从用户的角度来看，Cake 实例与 Pie 实例是不同类型的对象。但是，从虚拟机的角度来看，用户定义的每个类都只是另一个 ObjClass 类型的值。同样，用户程序中的每个实例，无论它是什么类的实例，都是一个 ObjInstance。这一虚拟机对象类型涵盖了所有类的实例。这两个世界之间的映射是这样的：

![A set of class declarations and instances, and the runtime representations each maps to.](./lox-clox.png)

明白了吗？好了，回到实现中。我们新增了一些熟悉的宏。

_<u>object.h，添加代码：</u>_

```c
#define IS_FUNCTION(value)     isObjType(value, OBJ_FUNCTION)
// 新增部分开始
#define IS_INSTANCE(value)     isObjType(value, OBJ_INSTANCE)
// 新增部分结束
#define IS_NATIVE(value)       isObjType(value, OBJ_NATIVE)
```

以及：

_<u>object.h，添加代码：</u>_

```c
#define AS_FUNCTION(value)     ((ObjFunction*)AS_OBJ(value))
// 新增部分开始
#define AS_INSTANCE(value)     ((ObjInstance*)AS_OBJ(value))
// 新增部分结束
#define AS_NATIVE(value) \
```

因为字段是在实例创建之后添加的，所以“构造器”函数只需要知道类。

_<u>object.h，在 newFunction()方法后添加代码：</u>_

```c
ObjFunction* newFunction();
// 新增部分开始
ObjInstance* newInstance(ObjClass* klass);
// 新增部分结束
ObjNative* newNative(NativeFn function);
```

我们在这里实现该函数：

_<u>object.c，在 newFunction()方法后添加代码：</u>_

```c
ObjInstance* newInstance(ObjClass* klass) {
  ObjInstance* instance = ALLOCATE_OBJ(ObjInstance, OBJ_INSTANCE);
  instance->klass = klass;
  initTable(&instance->fields);
  return instance;
}
```

我们存储了对实例的类的引用。然后我们将字段表初始化为一个空的哈希表。一个全新的对象诞生了！

在实例生命周期的最后阶段，它被释放了。

_<u>memory.c，在 freeObject()方法中添加代码：</u>_

```c
      FREE(ObjFunction, object);
      break;
    }
    // 新增部分开始
    case OBJ_INSTANCE: {
      ObjInstance* instance = (ObjInstance*)object;
      freeTable(&instance->fields);
      FREE(ObjInstance, object);
      break;
    }
    // 新增部分结束
    case OBJ_NATIVE:
```

实例拥有自己的字段表，所以当释放实例时，我们也会释放该表。我们没有显式地释放表中的条目，因为可能存在对这些对象的其它引用。垃圾回收器会帮我们处理这些问题。这里我们只释放表本身的条目数组。

说到垃圾回收，它需要支持通过实例进行跟踪。

_<u>memory.c，在 blackenObject()方法中添加代码：</u>_

```c
      markArray(&function->chunk.constants);
      break;
    }
    // 新增部分开始
    case OBJ_INSTANCE: {
      ObjInstance* instance = (ObjInstance*)object;
      markObject((Obj*)instance->klass);
      markTable(&instance->fields);
      break;
    }
    // 新增部分结束
    case OBJ_UPVALUE:
```

如果这个实例是活动的，我们需要保留它的类。此外，我们还需要保留每个被实例字段引用的对象。大多数不是根的活动对象都是可达的，因为某些实例会在某个字段中引用该对象。幸运的是，我们已经有了一个很好的`markTable()`函数，可以轻松地跟踪它们。

不太关键但仍然重要的是打印。

_<u>object.c，在 printObject()方法中添加代码：</u>_

```c
      break;
    // 新增部分开始
    case OBJ_INSTANCE:
      printf("%s instance",
             AS_INSTANCE(value)->klass->name->chars);
      break;
    // 新增部分结束
    case OBJ_NATIVE:
```

实例会打印它的名称，并在后面加上“instance”[^6]。（“instance”部分主要是为了使类和实例不会打印出相同的内容）

真正有趣的部分在解释器中，Lox 没有特殊的`new`关键字。创建类实例的方法是调用类本身，就像调用函数一样。运行时已经支持函数调用，它会检查被调用对象的类型，以确保用户不会试图调用数字或其它无效类型。

我们用一个新的 case 分支来扩展运行时的检查。

_<u>vm.c，在 callValue()方法中添加代码：</u>_

```c
    switch (OBJ_TYPE(callee)) {
      // 新增部分开始
      case OBJ_CLASS: {
        ObjClass* klass = AS_CLASS(callee);
        vm.stackTop[-argCount - 1] = OBJ_VAL(newInstance(klass));
        return true;
      }
      // 新增部分结束
      case OBJ_CLOSURE:
```

如果被调用的值（在左括号左边的表达式求值得到的对象）是一个类，则将其视为一个构造函数调用。我们创建一个被调用类的新实例，并将结果存储在栈中[^7]。

我们又前进了一步。现在我们可以定义类并创建它们的实例了。

```c
class Brioche {}
print Brioche();
```

注意第二行`Brioche`后面的括号。这里会打印“Brioche instance”。

## 27.4 Get 和 SET 表达式

实例的对象表示形式已经可以存储状态了，所以剩下的就是把这个功能暴露给用户。字段是使用 get 和 set 表达式进行访问和修改的。Lox 并不喜欢打破传统，这里也沿用了经典的“点”语法：

```c
eclair.filling = "pastry creme";
print eclair.filling;
```

句号——对英国朋友来说是句号——其作用有点像一个中缀运算符[^8]。左边有一个表达式，首先被求值并产生一个实例。之后是`.`后跟一个字段名称。由于前面有一个操作数，我们将其作为中缀表达式放到解析表中。

_<u>compiler.c，替换 1 行：</u>_

```c
  [TOKEN_COMMA]         = {NULL,     NULL,   PREC_NONE},
  // 替换部分开始
  [TOKEN_DOT]           = {NULL,     dot,    PREC_CALL},
  // 替换部分结束
  [TOKEN_MINUS]         = {unary,    binary, PREC_TERM},
```

和其它语言一样，`.`操作符绑定紧密，其优先级和函数调用中的括号一样高。解析器消费了点标识之后，会分发给一个新的解析函数。

_<u>compiler.c，在 call()方法后添加代码：</u>_

```c
static void dot(bool canAssign) {
  consume(TOKEN_IDENTIFIER, "Expect property name after '.'.");
  uint8_t name = identifierConstant(&parser.previous);

  if (canAssign && match(TOKEN_EQUAL)) {
    expression();
    emitBytes(OP_SET_PROPERTY, name);
  } else {
    emitBytes(OP_GET_PROPERTY, name);
  }
}
```

解析器希望在点运算符后面立即找到一个属性名称[^9]。我们将该词法标识的词素作为字符串加载到常量表中，这样该名称在运行时就是可用的。

我们将两种新的表达式形式——getter 和 setter——都交由这一个函数处理。如果我们看到字段名称后有一个等号，那么它一定是一个赋值给字段的 set 表达式。但我们并不总是允许编译字段后面的等号。考虑一下：

```c
a + b.c = 3
```

根据 Lox 的文法，这在语法上是无效的，这意味着我们的 Lox 实现有义务检测和报告这个错误。如果`dot()`默默地解析`=3`的部分，我们就会错误地解释代码，就像用户写的是：

```c
a + (b.c = 3)
```

问题是，set 表达式中的`=`侧优先级远低于`.`部分。解析器有可能会在一个优先级高到不允许出现 setter 的上下文中调用`dot()`。为了避免错误地允许这种情况，我们只有在`canAssign`为 true 时才去解析和编译等号部分。如果在`canAssign`为 false 时出现等号标识，`dot()`会保留它并返回。在这种情况下，编译器最终会进入`parsePrecedence()`，而该方法会在非预期的`=`（仍然作为下一个标识）处停止，并报告一个错误。

如果我们在允许使用等号的上下文中找到`=`，则编译后面的表达式。之后，我们发出一条新的`OP_SET_PROPERTY`指令[^10]。这条指令接受一个操作数，作为属性名称在常量表中的索引。如果我们没有编译 set 表达式，就假定它是 getter，并发出一条`OP_GET_PROPERTY`指令，它也接受一个操作数作为属性名。

现在是定义这两条新指令的好时机。

_<u>chunk.h，在枚举 OpCode 中添加代码：</u>_

```c
  OP_SET_UPVALUE,
  // 新增部分开始
  OP_GET_PROPERTY,
  OP_SET_PROPERTY,
  // 新增部分结束
  OP_EQUAL,
```

并在反汇编程序中为它们添加支持：

_<u>debug.c，在 disassembleInstruction()方法中添加代码：</u>_

```c
      return byteInstruction("OP_SET_UPVALUE", chunk, offset);
    // 新增部分开始
    case OP_GET_PROPERTY:
      return constantInstruction("OP_GET_PROPERTY", chunk, offset);
    case OP_SET_PROPERTY:
      return constantInstruction("OP_SET_PROPERTY", chunk, offset);
    // 新增部分结束
    case OP_EQUAL:
```

### 27.4.1 解释 getter 和 setter 表达式

进入运行时，我们从获取表达式开始，因为它们更简单一些。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      }
      // 新增部分开始
      case OP_GET_PROPERTY: {
        ObjInstance* instance = AS_INSTANCE(peek(0));
        ObjString* name = READ_STRING();

        Value value;
        if (tableGet(&instance->fields, name, &value)) {
          pop(); // Instance.
          push(value);
          break;
        }
      }
      // 新增部分结束
      case OP_EQUAL: {
```

当解释器到达这条指令时，点左边的表达式已经被执行，得到的实例就在栈顶。我们从常量池中读取字段名，并在实例的字段表中查找该名称。如果哈希表中包含具有该名称的条目，我们就弹出实例，并将该条目的值作为结果压入栈。

当然，这个字段可能不存在。在 Lox 中，我们将其定义为运行时错误。所以我们添加了一个检查，如果发生这种情况就中止。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
          push(value);
          break;
        }
        // 新增部分开始
        runtimeError("Undefined property '%s'.", name->chars);
        return INTERPRET_RUNTIME_ERROR;
        // 新增部分结束
      }
      case OP_EQUAL: {
```

你可能已经注意到了，还有另一种需要处理的失败模式。上面的代码中假定了点左边的表达式计算结果确实是一个 ObjInstance。但是没有什么可以阻止用户这样写：

```javascript
var obj = "not an instance";
print obj.field;
```

用户的程序是错误的，但是虚拟机仍然需要以某种优雅的方式来处理它。现在，它会把 ObjString 数据误认为是一个 ObjInstance ，并且，我不确定，代码起火或发生其它事情绝对是不优雅的。

在 Lox 中，只有实例才允许有字段。你不能把字段塞到字符串或数字中。因此，在访问某个值上的任何字段之前，检查该值是否是一个实例[^11]。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      case OP_GET_PROPERTY: {
        // 新增部分开始
        if (!IS_INSTANCE(peek(0))) {
          runtimeError("Only instances have properties.");
          return INTERPRET_RUNTIME_ERROR;
        }
        // 新增部分结束
        ObjInstance* instance = AS_INSTANCE(peek(0));
```

如果栈中的值不是实例，则报告一个运行时错误并安全退出。

当然，如果实例没有任何字段，get 表达式就不太有用了。因此，我们需要 setter。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
        return INTERPRET_RUNTIME_ERROR;
      }
      // 新增部分开始
      case OP_SET_PROPERTY: {
        ObjInstance* instance = AS_INSTANCE(peek(1));
        tableSet(&instance->fields, READ_STRING(), peek(0));
        Value value = pop();
        pop();
        push(value);
        break;
      }
      // 新增部分结束
      case OP_EQUAL: {
```

这比`OP_GET_PROPERTY`要复杂一些。当执行此指令时，栈顶有待设置字段的实例，在该实例之上有要存储的值。与前面一样，我们读取指令的操作数，并查找字段名称字符串。使用该方法，我们将栈顶的值存储到实例的字段表中。

在那之后是一些栈技巧。我们将存储的值弹出，然后弹出实例，最后再把值压回栈中。换句话说，我们从栈中删除第二个元素，而保留最上面的元素。setter 本身是一个表达式，其结果就是所赋的值，所以我们需要将值保留在栈上。我的意思是[^12]：

```javascript
class Toast {}
var toast = Toast();
print toast.jam = "grape"; // Prints "grape".
```

与读取字段不同，我们不需要担心哈希表中不包含该字段。如果需要的话，setter 会隐式地创建这个字段。我们确实需要处理用户不正确地试图在非实例的值上存储字段的情况。

_<u>vm.c，在 run()方法中添加代码：</u>_

```c
      case OP_SET_PROPERTY: {
        // 新增部分开始
        if (!IS_INSTANCE(peek(1))) {
          runtimeError("Only instances have fields.");
          return INTERPRET_RUNTIME_ERROR;
        }
        // 新增部分结束
        ObjInstance* instance = AS_INSTANCE(peek(1));
```

就像 get 表达式一样，我们检查值的类型，如果无效就报告一个运行时错误。这样一来，Lox 对面向对象编程中有状态部分的支持就到位了。试一试：

```javascript
class Pair {}

var pair = Pair();
pair.first = 1;
pair.second = 2;
print pair.first + pair.second; // 3.
```

这感觉不太面向对象。它更像是一种奇怪的、动态类型的 C 语言变体，其中的对象是松散的类似结构体的数据包。有点像动态过程化语言。但这是表达能力的一大进步。我们的 Lox 实现现在允许用户自由地将数据聚合成更大的单元。在下一章中，我们将为这些迟缓的数据注入活力。

[^1]: 那些对面向对象编程有强烈看法的人——读作“每个人”——往往认为 OOP 意味着一些非常具体的语言特性清单，但实际上有一个完整的空间可以探索，而每种语言都有自己的成分和配方。<BR>Self 有对象但没有类。CLOS 有方法，当没有把它们附加到特定的类中。C++最初没有运行时多态——没有虚方法。Python 有多重继承，但 Java 没有。Ruby 把方法附加在类上，但你也可以在单个对象上定义方法。
[^2]: !['Klass' in a zany kidz font.](./klass.png)我将变量命名为“klass”，不仅仅是为了给虚拟机一种古怪的幼儿园的"Kidz Korner "感觉。它使得 clox 更容易被编译为 C++，而 C++中“class”是一个保留字。
[^3]: 我们可以让类声明成为表达式而不是语句——比较它们本质上是一个产生值的字面量。然后用户必须自己显式地将类绑定到一个变量，比如：`var Pie = class {}`。这有点像 lambda 函数，但只是针对类的。但由于我们通常希望类被命名，所以将其视为声明是有意义的。
[^4]: “局部（Local）”类——在函数或块主体中声明的类，是一个不寻常的概念。许多语言根本不允许这一特性。但由于 Lox 是一种动态类型脚本语言，它会对程序的顶层代码和函数以及块的主体进行统一处理。类只是另一种声明，既然你可以在块中声明变量和函数，那你也可以在块中声明类。
[^5]: 能够在运行时自由地向对象添加字段，是大多数动态语言和静态语言之间的一个很大的实际区别。静态类型语言通常要求显式声明字段。这样，编译器就确切知道每个实例有哪些字段。它可以利用这一点来确定每个实例所需的精确内存量，以及每个字段在内存中的偏移量。<BR>在 Lox 和其它动态语言中，访问字段通常是一次哈希表查询。常量时间复杂度，但仍然是相当重的。在 C++这样的语言中，访问一个字段就像对指针偏移一个整数常量一样快。
[^6]: 大多数面向对象的语言允许类定义某种形式的`toString()`方法，让该类指定如何将其实例转换为字符串并打印出来。如果 Lox 不是一门玩具语言，我也想要支持它。
[^7]: 我们暂时忽略传递给调用的所有参数。在下一章添加对初始化器的支持时，我们会重新审视这一段代码。
[^8]: 我说“有点”是因为`.`右边的不是表达式，而是一个标识符，其语义由 get 或 set 表达式本身来处理。它实际上更接近于一个后缀表达式。
[^9]: 编译器在这里使用“属性（property）”而不是“字段（field）”，因为，请记住，Lox 还允许你使用点语法来访问一个方法而不调用它。“属性”是一个通用术语，我们用来指代可以在实例上访问的任何命名实体。字段是基于实例状态的属性子集。
[^10]: 你不能设置非字段属性，所以我认为这个指令本该是`OP_SET_FIELD`，但是我认为它与 get 指令一致看起来更漂亮。
[^11]: Lox*可以*支持向其它类型的值中添加字段。这是我们的语言，我们可以做我们想做的。但这可能是个坏主意。它大大增加了实现的复杂性，从而损害了性能——例如，字符串驻留变得更加困难。<BR>此外，它还引起了关于数值的相等和同一性的复杂语义问题。如果我给数字`3`附加一个字段，那么`1+2`的结果也有这个字段吗？如果是的话，实现上如何跟踪它？如果不是，这两个结果中的“3”仍然被认为是相等的吗？
[^12]: 栈的操作是这样的：![Popping two values and then pushing the first value back on the stack.](./stack.png)

---

## 习题

1. 试图访问一个对象上不存在的字段会立即中止整个虚拟机。用户没有办法从这个运行时错误中恢复过来，也没有办法在试图访问一个字段之前看它是否存在。需要由用户自己来确保只读取有效字段。

   其它动态类型语言是如何处理缺少字段的？你认为 Lox 应该怎么做？实现你的解决方案。

2. 字段在运行时是通过它们的*字符串*名称来访问的。但是该名称必须总是作为标识符直接出现在源代码中。用户程序不能命令式地构建字符串值，然后将其用作字段名。你认为应该这样做吗？那就设计一种语言特性来实现它。

3. 反过来说，Lox 没有提供从实例中*删除*字段的方法。你可以将一个字段的值设置为`nil`，但哈希表中的条目仍然存在。其它语言如何处理这个问题？为 Lox 选择一个策略并实现。

4. 因为字段在运行时是按照名称访问的，所以对实例状态的操作是很慢的。从技术上讲，这是一个常量时间的操作（感谢哈希表），但是常量因子比较大。这就是动态语言比静态语言慢的一个主要原因。

   动态类型语言的复杂实现是如何应对和优化这一问题的？
