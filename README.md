# postcss-athena-spritesmith

针对`Athena`订制的`CSS雪碧图`工具，源码改自[postcss-sprite](https://github.com/2createStudio/postcss-sprites)
## ChangeLog

请见[ChangeLog](CHANGELOG.md)

## Install

```bash
npm install postcss-athena-spritesmith -D
```

## How To Use

### gulpfile.js

```javascript
var gulp = require('gulp');
var postcss = require('gulp-postcss');
var sprites = require('postcss-sprites');
var opts = {
  stylesheetPath: modulePath + '/dist/_static/css/',
  spritePath: modulePath + '/dist/_static/images/sprite.png',
  retina: true,
  verbose: true
}
gulp.src( modulePath + '/dist/_static/css' )
    .pipe(postcss(sprites(opts)))
    .dest( modulePath + '/dist/_static/css' )
```

### source.css

> 直接在需要合并雪碧图的CSS的url图片带`?__sprite`后缀即可

```css
/* 请确保需要合并雪碧图的后缀带有`?__sprite` */
body {
  background: url('images/ball.png?__sprite'); 
}

h1 {
 background-image: url('images/help.png?__sprite');
}
```
### 功能更新目录
提供了自定义生成多张雪碧图的功能，例如引用图片A/B/C/D，想要让A/B生成雪碧图sprite_1，C/D生成雪碧图sprite_2，则可以通过分别携带后缀?__sprite=sprite_1和?__sprite=sprite_2来生成两张雪碧图。
#### source.css

```css

.a {
  background-image: url('images/A.png?__sprite=sprite_1');
}

.b {
  background-image: url('images/B.png?__sprite=sprite_1');
}
.c {
  background-image: url('images/C.png?__sprite=sprite_2');
}

.d {
  background-image: url('images/D.png?__sprite=sprite_2');
}
```

#### output.css

```css

.a {
  background-image: url('images/sprite_sprite_1.png');
}

.b {
  background-image: url('images/sprite_sprite_1.png');
}
.c {
  background-image: url('images/sprite_sprite_2.png');
}

.d {
  background-image: url('images/sprite_sprite_2.png');
}
```

配置中 `rootValue` 是控制当前模块全局的 `rem` 开关，如果想要指定某一处图片相关样式使用 `px` 或 `rem` 单位，可以在引用图片的地方通过参数指定，例如

```css
// 指定使用 `px` 单位
.a {
  background-image: url('images/A.png?__sprite=sprite_1&__px');
}

// 指定使用 `rem` 单位
.a {
  background-image: url('images/A.png?__sprite=sprite_1&__rem');
}

// 使用 `rem` 单位时同时指定自己的 `rootValue`
.a {
  background-image: url('images/A.png?__sprite=sprite_1&__rem=20');
}
```

配置中 `__widthHeight` 是控制关闭强制替换背景图width和height，例如

```css
// 强制使用 `__widthHeight` 来关闭width和height替换
.a {
  background-image: url('images/A.png?__sprite=sprite_1&__widthHeight');
  width:10px;
  height:10px;
}
```
增加 `__widthHeight` 与 `__rem=20`同时配置使用
```
.a {
  background-image: url('images/A.png?__sprite=sprite_1&__widthHeight&__rem=20');
  width: 22px;
  height: 30px;
}
```
#### output.css
```
.a {
    background-image: url('images/sprite_sprite_1.png');
    background-position: -81.6rem -24.05rem;
    background-repeat: no-repeat;
    width: 1.1rem;
    height: 1.5rem;
}
```
