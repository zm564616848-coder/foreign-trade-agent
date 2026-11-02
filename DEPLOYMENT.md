# 公网发布：GitHub Pages

本项目的全部查询交互运行在浏览器，可将 `public/` 直接发布为静态网站，不需要 Node.js 公网服务器或 API 密钥。已将资源地址改为相对路径，支持 GitHub Pages 的仓库子目录。

`.github/workflows/pages.yml` 会在 main 分支收到提交后执行语法检查和测试，然后上传 `public/` 并部署 GitHub Pages。

仓库需要先启用 GitHub Pages，发布来源选择 **GitHub Actions**。若仓库是私有仓库，还需要账号套餐支持相应的 Pages 功能。工作流须获准执行并向 github-pages 环境部署。

发布完成必须检查 Actions 的部署结果及实际公网页面，不应仅根据代码推送成功推断网站已经上线。

发布后网站仅提供官网跳转和浏览器本地记录，不接收服务器端运单，不提供跨设备同步。页面中点击单个单号查询会打开对应官网。
