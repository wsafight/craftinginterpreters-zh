// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import swup from '@swup/astro';

// https://astro.build/config
export default defineConfig({
  site: "https://wsafight.github.io",
  base: "craftinginterpreters-zh",
  redirects: {
    "/": "/craftinginterpreters-zh/about/part-1"
  },
  integrations: [
    starlight({
      title: "手写解释器(翻译)",
      social: {
        github: "https://github.com/wsafight/craftinginterpreters-zh",
      },
      sidebar: [
        {
          label: "I.欢迎",
          items: [
            {
              label: "第一部分",
              slug: "about/part-1",
            },
            {
              label: "01.介绍",
              slug: "introduction/readme",
            },
            {
              label: "02.领土地图",
              slug: "a-map-of-the-territory/readme",
            },
          ],
        },

        {
          label: "II.Tree-Walk 解释器",
          items: [
            {
              label: "第二部分",
              slug: "about/part-2",
            },
            {
              label: "03.Lox 语言",
              slug: "the-lox-language/readme",
            },
            {
              label: "04.扫描",
              slug: "scanning/readme",
            },
            {
              label: "05.表示代码",
              slug: "representing-code/readme",
            },
            {
              label: "06.解析表达式",
              slug: "parsing-expressions/readme",
            },
            {
              label: "07.表达式求值",
              slug: "evaluating-expressions/readme",
            },
            {
              label: "08.声明和状态",
              slug: "statements-and-state/readme",
            },
            {
              label: "09.控制流",
              slug: "control-flow/readme",
            },
            {
              label: "10.函数",
              slug: "functions/readme",
            },
            {
              label: "11.解析与绑定",
              slug: "resolving-and-binding/readme",
            },
            {
              label: "12.类",
              slug: "classes/readme",
            },
            {
              label: "13.继承",
              slug: "inheritance/readme",
            },
          ],
        },

        {
          label: "III.字节码虚拟机",
          items: [
            {
              label: "第三部分",
              slug: "about/part-3",
            },
            {
              label: "14.字节码块",
              slug: "chunks-of-bytecode/readme",
            },
            {
              label: "15.虚拟机",
              slug: "a-virtual-machine/readme",
            },
            {
              label: "16.按需扫描",
              slug: "scanning-on-demand/readme",
            },
            {
              label: "17.编译表达式",
              slug: "compiling-expressions/readme",
            },
            {
              label: "18.值类型",
              slug: "types-of-values/readme",
            },
            {
              label: "19.字符串",
              slug: "strings/readme",
            },
            {
              label: "20.哈希表",
              slug: "hash-tables/readme",
            },
            {
              label: "21.全局变量",
              slug: "global-variables/readme",
            },
            {
              label: "22.局部变量",
              slug: "local-variables/readme",
            },
            {
              label: "23.来回跳转",
              slug: "jumping-back-and-forth/readme",
            },
            {
              label: "24.调用和函数",
              slug: "calls-and-functions/readme",
            },
            {
              label: "25.闭包",
              slug: "closures/readme",
            },
            {
              label: "26.垃圾回收",
              slug: "garbage-collection/readme",
            },
            {
              label: "27.类与实例",
              slug: "classes-and-instances/readme",
            },
            {
              label: "28.方法和初始化器",
              slug: "methods-and-initializers/readme",
            },
            {
              label: "29.超类",
              slug: "superclasses/readme",
            },
            {
              label: "30.优化",
              slug: "optimization/readme",
            },
          ],
        },
        {
          label: "后记",
          items: [
            {
              label: "附录1",
              slug: "about/appendix-1",
            },
            {
              label: "附录2",
              slug: "about/appendix-2",
            },
          ],
        },
      ],
    }),
    swup({
      containers: ['main','.sidebar-content', 'aside'],
    })
  ],
  compressHTML: true,

});
