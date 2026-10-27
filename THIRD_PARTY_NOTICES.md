# 第三方素材与依赖

本项目原创代码使用 [MIT 许可证](LICENSE)。第三方软件、字体和照片不因此改用 MIT，继续适用其各自许可证。

## 照片

登录页的 `public/images/login-mountains.webp` 来源于摄影师 [Alessio Soggetti](https://unsplash.com/@asoggetti) 在 Unsplash 发布的 [Mountains covered with fogs](https://unsplash.com/photos/mountains-covered-with-fogs-gdE-5Oui1Y0)，适用 [Unsplash License](https://unsplash.com/license)。图片已本地保存，页面加载不会向图片服务发送请求。原始素材信息见 [图片说明](public/images/README.md)。

## 字体

通过 Fontsource 使用 Manrope、Space Grotesk 和 JetBrains Mono。字体许可证保留在对应依赖包中，请遵循其 SIL Open Font License 条款。

## 软件依赖

React、Vite、Dexie、Radix UI、Lucide、DOMPurify、Marked、KaTeX、Mammoth、PDF.js、JSZip、Electron 等依赖的完整版本与来源由 `package-lock.json` 固定。具体许可证见对应依赖包的 `LICENSE` 或相关文件。

Windows 打包会随内置 Node 运行环境附带对应版本的 Node 许可证；Electron 与 Chromium 的第三方说明由其发行文件提供。
