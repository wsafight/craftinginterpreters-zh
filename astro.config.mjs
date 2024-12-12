// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://wsafight.github.io",
  base: "craftinginterpreters-zh",
  redirects: {
    "/": "/craftinginterpreters-zh/introduction/readme",
    // "/": "/introduction/readme",
  },
  integrations: [
    starlight({
      title: "手写解释器",
      social: {
        github: "https://github.com/wsafight/craftinginterpreters-zh",
      },
      sidebar: [
        {
          label: "01.前言",
          slug: "introduction/readme",
        },
        {
          label: "02.领土地图",
          slug: "a-map-of-the-territory/readme",
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
          label: '06.解析表达式',
          slug: "parsing-expressions/readme"
        },
        {
          label: "07.表达式求值",
          slug: "evaluating-expressions/readme"
        },
        {
          label: "08.声明和状态",
          slug: "statements-and-state/readme"
        },
        {
          label: "09.控制流",
          slug: "control-flow/readme"
        },
        {
          label: "10.函数",
          slug: "functions/readme"
        },
        {
          label: "11.解析与绑定",
          slug: "resolving-and-binding/readme"
        },
        {
          label: "12.类",
          slug: "classes/readme"
        },
        {
          label: "13.继承",
          slug: "inheritance/readme"
        },
        {
          label: "14.字节码块",
          slug: "chunks-of-bytecode/readme"
        },
        {
          label: "15.虚拟机",
          slug: "a-virtual-machine/readme"
        },
        {
          label: "16.按需扫描",
          slug: "scanning-on-demand/readme"
        },
        {
          label: "17.编译表达式",
          slug: "compiling-expressions/readme"
        },
        {
          label: "18.值类型",
          slug: "types-of-values/readme"
        },
      ],
    }),
  ],
  compressHTML: true,
});
