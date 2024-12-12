// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// https://astro.build/config
export default defineConfig({
  site: "https://wsafight.github.io",
  base: "craftinginterpreters-zh",
  redirects: {
    "/": "/craftinginterpreters-zh/business/currency",
  },
  integrations: [
    starlight({
      title: "手撸解释器教程",
      social: {
        github: "https://github.com/wsafight/craftinginterpreters-zh",
      },
      sidebar: [
        {
          label: '',
          items: [
            { label: "简单货币格式化", slug: "business/currency" },
            {
              label: "通过 Dinero 和 Intl 处理货币数据",
              slug: "business/dinero",
            },
            {
              label: "文件大小格式化 (简单版)",
              slug: "business/format-file-size",
            },
            { label: "文件格式化库 filesize", slug: "business/filesize" },
            { label: "根据数组构建树", slug: "business/build-tree" },
            { label: "树组件查询", slug: "business/array-tree-filter" },
            { label: "计算博客阅读时长", slug: "business/reading-time" },
            {
              label: "根据背景色自适应文本颜色",
              slug: "business/contrast-text-color",
            },
            { label: "输入错误提示 —— 模糊集", slug: "business/fuzzy-set" },
            { label: "阿拉伯数字与中文数字的相互转换", slug: "business/nzh" },
            { label: "网页公式排版工具 KaTeX", slug: "business/katex" },
            { label: "颜色排序算法", slug: "business/color-sort" },
            {
              label: "交互式医学图像工具 Cornerstone",
              slug: "business/cornerstone",
            },
            { label: "快速制作出响应式邮件的框架 Mjml", slug: "business/mjml" },
            { label: "超长定时器 long-timeout", slug: "business/long-timeout" },
            {
              label: "基于内存的全文搜索引擎 MiniSearch",
              slug: "business/mini-search",
            },
            { label: "机器人工具集合", slug: "business/robot-tools" },
          ],
        },
      ],
    }),
  ],
  compressHTML: true
});
