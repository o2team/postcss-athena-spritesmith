'use strict';

/**
 * Module dependencies.
 */
var fs          = require('fs');
var path        = require('path');
var util        = require('util');
var postcss     = require('postcss');
var lodash      = require('lodash');
var async       = require('async');
var Q           = require('q');
var spritesmith = require('spritesmith');
var mkdirp      = require('mkdirp');

/**
 * Constants.
 *
 * @type {String}
 */
var GROUP_DELIMITER   = '.';
var GROUP_MASK        = '*';
var BACKGROUND        = 'background';
var BACKGROUND_IMAGE  = 'background-image';
var BACKGROUND_COLOR  = 'background-color';
var BACKGROUND_REPEAT = 'background-repeat';
var BACKGROUND_SIZE   = 'background-size';

/**
 * Defaults.
 *
 * @type {Object}
 */
var defaults = {
	stylesheetPath  : './',
	imageFolder				: 'images',
	spritePath      : './sprite.png',
	backupPath      : './',
	skipPrefix      : false,
	outputDimensions: true,
	filterBy        : [],
	groupBy         : [],
	retina          : false,
	verbose         : false,
	rootValue       : 0,

	// spritesmith options
	engine        : 'pixelsmith',
	algorithm     : 'binary-tree',
	padding       : 4,
	engineOpts    : {},
	exportOpts    : {}
};
/**
 * Register the PostCSS plugin.
 */
module.exports = postcss.plugin('postcss-athena-spritesmith', plugin);
/**
 * PostCSS plugin definition.
 *
 * @param  {Object}  opts
 * @return {Function}
 */
function plugin(opts) {
	// Extend default options.
	var options = lodash.merge({}, defaults, opts || {});
	// Prepare filterBy functions.
	setupFilterBy(options);

	// Prepare groupBy functions.
	setupGroupBy(options);

	// Plugin initializer.
	return function(css) {
		return Q
			.fcall(function(){
				return getImages(css, options)
			})
			.spread(applyFilterBy)
			.spread(applyGroupBy)
			.spread(function(images, opts){
				return setTokens(images, opts, css);
			})
			.spread(runSpriteSmith)
			.spread(saveSprites)
			.spread(mapSpritesProperties)
			.spread(function(images, opts, sprites) {
				return updateReferences(images, opts, sprites, css);
			})
			.catch(function(err) {
				if (err) {
					log('Error: ' + err);
				}
			});
	};
}

/**
 * Return all images that can be used
 * to generate a sprite.
 *
 * @param  {Object} css
 * @param  {Object} opts
 * @return {Array}
*/
function getImages(css, opts) {
		var images = [];
		//save local rootValue
		var spriteRootValue = opts.rootValue;
		// Find only background & background-image declarations.
		css.walkRules(function(rule) {
			var styleFilePath = rule.source.input.file;
			var urlSpeObj = '';
			// The host object
			// for each found image.
			var image = {
				path    : null,
				url     : null,
				urlSpe  : null,
				retina  : false,
				ratio   : 1,
				groups  : [],
				token   : ''
			};

			// Manipulate only rules with background image
			// in them.
			if (hasImageInRule(rule.toString()) && hasSpriteTagInRule(rule.toString())) {
				image.url = getImageUrl(rule.toString());
				urlSpeObj = getImageUrlSpe(rule.toString(),image,spriteRootValue);
				if(urlSpeObj.widthHeight && urlSpeObj.widthHeight.indexOf('__widthHeight') != -1){
					image.widthHeight = false;
				}
				image.urlSpe = urlSpeObj.urlSpe.split('&')[0];
				image.rootValue = urlSpeObj.rootValue;
				if (isImageSupported(image.url)) {
					// Perform search for retina
					// images if option is allowed.
					//去掉 opts.retina 配置 by panxinwu
					if (isRetinaImage(image.url)) {
						image.retina = true;
						image.ratio  = getRetinaRatio(image.url);
					}
					// Get the path to the image.
					var _path = styleFilePath.substring(0, styleFilePath.lastIndexOf(path.sep));
					var __path = _path.substring(0, _path.lastIndexOf(path.sep));
					var _url = getImagePath(opts.imageFolder, image.url).path;
					image.path = path.resolve(__path, _url);
					if (!fs.existsSync(image.path)) {
						var backupPath = path.resolve(opts.backupPath, _url);
						image.path = backupPath;
					}
					images.push(image);

				} else {
					console.log('Skip ' + image.url + ' - not supported.', opts.verbose);
				}
			}
		});

		// Remove duplicates and empty values
		images = lodash
			.chain(images)
			.unique(function(image) {
				return image.path;
			})
			.value();
		return [images, opts];
}

function getImagePath (imageFolder, fpath) {
	var dirname = path.dirname(fpath);
	var dirnameArr = [];
	var splitFlag = '';
	if (dirname.indexOf('\/') >= 0) {
		splitFlag = '\/';
	} else {
		splitFlag = '\\';
	}
	dirnameArr = dirname.split(splitFlag);
	var imagesIndex = dirnameArr.indexOf(imageFolder);
	if (imagesIndex >= 0) {
		fpath = fpath.split(splitFlag).splice(imagesIndex).join(splitFlag);
	}
	return {
		index: imagesIndex,
		path: fpath
	};
}

/**
 * Prepare functions that will be used
 * to filter images.
 *
 * @param  {Object} opts
 * @return
 */
function setupFilterBy(opts) {
	// Convert user function to array
	if (lodash.isFunction(opts.filterBy)) {
		opts.filterBy = [opts.filterBy];
	}

	// Remove non existing images
	opts.filterBy.unshift(function(image) {
		return Q.Promise(function(resolve, reject) {
			fs.exists(image.path, function(exists) {
				if (!exists) {
					log('Skip ' + image.url + ' - not exist.',  opts.verbose);
				}
				resolve(exists);
			});
		});
	});
}

/**
 * Apply filterBy functions.
 *
 * @param  {Array}  images
 * @param  {Object} opts
 * @return {Promise}
 */
function applyFilterBy(images, opts) {
	return Q.Promise(function(resolve, reject) {
		async.reduce(opts.filterBy, images, function(images, filter, next) {
			async.filter(images, function(image, ok) {
				Q(filter(image))
					.then(ok);
			}, function(images) {
				next(null, images);
			});
		}, function(err, images) {
			if (err) {
				return reject(err);
			}
			resolve([images, opts]);
		});
	});
}

/**
 * Prepare functions that will be used
 * to group images.
 *
 * @param  {Object} opts
 * @return
 */
function setupGroupBy(opts) {
	// Convert user function to array
	if (lodash.isFunction(opts.groupBy)) {
		opts.groupBy = [opts.groupBy];
	}

	opts.groupBy.unshift(function(image) {
		if (image.retina) {
			return '@' + image.ratio + 'x';
		}

		return null;
	});
}

/**
 * Apply groupBy functions.
 *
 * @param  {Array}  images
 * @param  {Object} opts
 * @return {Promise}
 */
function applyGroupBy(images, opts) {
	return Q.Promise(function(resolve, reject) {
		async.reduce(opts.groupBy, images, function(images, group, next) {
			async.map(images, function(image, done) {
				Q(group(image))
					.then(function(group) {
						if (group) {
							image.groups.push(group);
						}

						done(null, image);
					})
					.catch(done);
			}, next);
		}, function(err, images) {
			if (err) {
				return reject(err);
			}

			resolve([images, opts]);
		});
	});
}

/**
 * Replace declarations with comment tokens.
 *
 * @param  {Array} images
 * @param  {Object} opts
 * @param  {Object} css
 * @return {Promise}
 */
function setTokens(images, opts, css) {
	return Q.Promise(function(resolve, reject) {
		css.walkDecls(/^background(-image|-repeat)?$/, function(decl) {
			var rule = decl.parent;
			var url, image, color, declaration, repeat;

			// Manipulate only rules with background image
			// in them.
			if ( hasImageInRule( rule.toString() ) && hasSpriteTagInRule( rule.toString() ) ) {
				url   = getImageUrl(rule.toString());
				image = lodash.find(images, { url: url });

				if (image) {
					// We remove these declarations since
					// our plugin will insert them when
					// they are necessary
					if(!image.rootValue && (image.widthHeight || image.widthHeight === false)){
						rule.walkDecls(/^background-(repeat|size|position)$/, function(decl) {
							decl.remove();
						});
					}else{
						rule.walkDecls(/^background-(repeat|size|position)|^width|^height$/, function(decl) {
							decl.remove();
						});
					}
					if (decl.prop === BACKGROUND) {
						
						color = getColor(decl);					

						// Extract color to background-color propery
						if (color && color.length === 1) {
							declaration = postcss.decl({
								prop: 'background-color',
								value: color[0]
							});
							declaration.raws.before = ' ';

							rule.append(declaration);
						}
					}					

					if (decl.prop === BACKGROUND || decl.prop === BACKGROUND_IMAGE) {
						image.token = postcss.comment({
							text: image.url
						});

						image.token.raws.before = ' ';
						image.token.raws.left   = '@replace|';
						image.token.raws.right  = '';

						// Replace the declaration with a comment token
						// which will be used later for reference.
						decl.replaceWith(image.token);
					}
				}

			}			

		});

		

		resolve([images, opts]);
	});
}

/**
 * Process the images with spritesmith module.
 *
 * @param  {Array}  images
 * @param  {Object} opts
 * @return {Promise}
 */
function runSpriteSmith(images, opts) {
	return Q.Promise(function(resolve, reject) {
		var all = lodash
			.chain(images)
			.groupBy(function (image) {
				var temp;
				temp = image.groups.map(mask(true));				
				temp.unshift('_');

				return temp.join(GROUP_DELIMITER);
			})
			.map(function(images, temp) {
				var config = lodash.merge({}, opts, {
					src: lodash.pluck(images, 'path')
				});
				var ratio;

				// Enlarge padding for retina images
				if (areAllRetina(images)) {
					ratio = lodash
						.chain(images)
						.flatten('ratio')
						.unique()
						.value();

					if (ratio.length === 1) {
						config.padding = config.padding * ratio[0];
					}
				}

				return Q.nfcall(spritesmith, config)
					.then(function(result) {
						temp = temp.split(GROUP_DELIMITER);
						temp.shift();

						// Append info about sprite group
						result.groups = temp.map(mask(false));
						return result;
					});
			})
			.value();

		Q.all(all)
			.then(function(results) {
				resolve([images, opts, results]);
			})
			.catch(function(err) {
				if (err) {
					reject(err);
				}
			});
	});
}

/**
 * Export sprites to files.
 *
 * @param  {Array}  images
 * @param  {Object} opts
 * @param  {Array}  sprites
 * @return {Promise}
 */
function saveSprites(images, opts, sprites) {
	return Q.Promise(function(resolve, reject) {

		if (!fs.existsSync(path.dirname(opts.spritePath))) {
			mkdirp.sync(path.dirname(opts.spritePath));
		}

		var all = lodash
			.chain(sprites)
			.map(function(sprite) {
				sprite.path = makeSpritePath(opts, sprite.groups);
				return Q.nfcall(fs.writeFile, sprite.path, new Buffer(sprite.image, 'binary'))
					.then(function() {
						return sprite;
					});
			})
			.value();

		Q.all(all)
			.then(function(sprites) {
				resolve([images, opts, sprites]);
			})
			.catch(function(err) {
				if (err) {
					reject(err);
				}
			});
	});
}

/**
 * Map properties for every image.
 *
 * @param  {Array}  images
 * @param  {Object} opts
 * @param  {Array}  sprites
 * @return {Promise}
 */
function mapSpritesProperties(images, opts, sprites) {
	return Q.Promise(function(resolve, reject) {
		sprites = lodash.map(sprites, function(sprite) {
			return lodash.map(sprite.coordinates, function (coordinates, imagePath) {
			// console.log(JSON.stringify(coordinates,null,4));
				return lodash.merge(lodash.find(images, { path: imagePath }), {
					coordinates: coordinates,
					spritePath: sprite.path,
					properties: sprite.properties
				});
			});
		});

		resolve([images, opts, sprites]);
	});
}

/**
 * Update the CSS references.
 *
 * @param  {Array}  images
 * @param  {Object} opts
 * @param  {Array}  sprites
 * @param  {Object} css
 * @return {Promise}
 */
function updateReferences(images, opts, sprites, css) {
	return Q.Promise(function(resolve, reject) {
		css.walkComments(function(comment) {
			var rule, image, backgroundImage, backgroundPosition, backgroundSize, backgroundRepeat;

			// Manipulate only token comments
			if (isToken(comment)) {

				image = lodash.find(images, { url: comment.text });				
				if (image) {
					// Generate correct ref to the sprite
					image.spriteRef = path.relative(opts.stylesheetPath, image.spritePath);
					image.spriteRef = image.spriteRef.split(path.sep).join('/');

					backgroundImage = postcss.decl({
						prop: 'background-image',
						value: getBackgroundImageUrl(image)
					});
					backgroundPosition = postcss.decl({
						prop: 'background-position',
						value: getBackgroundPosition(image,opts)
					});

					backgroundRepeat = postcss.decl({
						prop: 'background-repeat',
						value: 'no-repeat'
					});

					// Replace the comment and append necessary properties.
					comment.replaceWith(backgroundImage);

					// Output the dimensions
					rule = backgroundImage.parent;
					if(!(image.widthHeight === false) || image.rootValue){
						if (opts.outputDimensions) {
							['height', 'width'].forEach(function(prop) {
								rule.insertAfter(backgroundImage, postcss.decl({
									prop: prop,
									value: getDimensions(image, opts, prop)
								}));
							});
						}
					}
					rule.insertAfter(backgroundImage, backgroundPosition);

					rule.insertAfter(backgroundPosition, backgroundRepeat);

					if (image.retina) {
						backgroundSize = postcss.decl({
							prop: 'background-size',
							value: getBackgroundSize(image, opts)
						});

						backgroundPosition.parent.insertAfter(backgroundPosition, backgroundSize);
					}
				}
			}
		});

		resolve([images, opts, sprites, css]);
	});
}

/**
 * Output a message to the console.
 *
 * @param  {String}  message
 * @param  {Boolean} verbose
 * @return
 */
function log(message, verbose) {
	if (message && !verbose) {
		util.log(util.format('[postcss-sprites] => %s', message));
	}
}

/**
 * Check that the declaration is background.
 * E.g. background-image, background, etc.
 *
 * @param  {Object}  decl
 * @return {Boolean}
 */
function isBackgroundDecl(decl) {
	return /^background/gi.test(decl.prop);
}

/**
 * Check for url in the given rule.
 *
 * @param  {String}  rule
 * @return {Boolean}
 */
function hasImageInRule(rule) {
	return /background[^:]*.*url[^;]+;/gi.test(rule);
}

function hasSpriteTagInRule(rule) {
	return /\?__sprite/gi.test(rule);
}

// 获取sprite后面的图片区分符
// pxToRem按单个图片单独处理，存储于image内，最终push到images
function getImageUrlSpe(rule,image,rootValue) {
	var match = /background[^:]*:.*url\(([\S]+)\)/gi.exec(rule);
	
	var matchSprite = match[1].replace(/['"]/gi, '');
	///&__rem=20 是否存在rootValue 存在则单独处理否则赋值系统默认值
	matchSprite.split('&__rem=')[1] ? image.rootValue = /-?\d+\.?\d*/gi.exec(matchSprite.split('&__rem=')[1])[0] : image.rootValue = rootValue;

	///images/dog.png?__sprite=sprite_2   '=' 后面是否赋值？赋值 则分类合并雪碧图 否则 系统默认 sprite
	matchSprite.split('&')[0].split('=')[1] ? image.urlSpe = matchSprite.split('=')[1] : image.urlSpe = '';
	matchSprite.split('&')[1] === '__px' ? image.rootValue = 0 : null;
	matchSprite.indexOf('__widthHeight') != -1 ? image.widthHeight = false : null;
	//有widthHeight参数则从css里保存width height数值用于后面计算pxToRem
	if(image.widthHeight === false){
		var widthReg = /width:\s*-?\d+\.?\d*.*/gi;
		var heightReg = /height:\s*-?\d+\.?\d*.*/gi;
		var pxReg = /width:\s*-?\d+\.?\d*.px/gi;
		var matchWidth = widthReg.exec(rule);
		var matchHeight = heightReg.exec(rule);
		//只有单位为px时才开启pxToRem
		if(!pxReg.exec(rule)){
			image.rootValue = 0;
		}
		if(matchWidth && lodash.isArray(matchWidth)){
			image.width = /-?\d+\.?\d*/gi.exec(matchWidth[0])[0];
		}
		if(matchHeight && lodash.isArray(matchHeight)){
			image.height = /-?\d+\.?\d*/gi.exec(matchHeight[0])[0];
		}
	}
	return {
		'urlSpe': image.urlSpe,
		'rootValue': image.rootValue,
		'widthHeight': image.widthHeight,
		'width': image.width,
		'height': image.height
	};
}


/**
 * Extract the path to image from the url in given rule.
 *
 * @param  {String} rule
 * @return {String}
 */
function getImageUrl(rule) {
	var match = /background[^:]*:.*url\(([\S]+)\)/gi.exec(rule);
	return match ? match[1].replace(/['"]/gi, '').split('?')[0] : '';
}

/**
 * Extract the background color from declaration.
 *
 * @param  {Object} decl
 * @return {String|null}
 */
function getColor(decl) {
	var regexes = ['(#([0-9a-f]{3}){1,2})', 'rgba?\\([^\\)]+\\)'];
	var matches = null;

	lodash.forEach(regexes, function(regex) {
		var regex = new RegExp(regex, 'gi');

		if (regex.test(decl.value)) {
			matches = decl.value.match(regex);
		}
	});

	return matches;
}

/**
 * Check whether the image is supported.
 *
 * @param  {String}  url
 * @return {Boolean}
 */
function isImageSupported(url) {
	var httpRegex = /http[s]?/gi;

	return !httpRegex.test(url);
}

/**
 * Check whether the image is retina.
 * @param  {String}  url
 * @return {Boolean}
 */
function isRetinaImage(url) {
	return /@(\d)x\.[a-z]{3,4}$/gi.test(url);
}

/**
 * Return the retina ratio.
 *
 * @param  {String} url
 * @return {Number}
 */
function getRetinaRatio(url) {
	var matches = /@(\d)x\.[a-z]{3,4}$/gi.exec(url);
	var ratio   = lodash.parseInt(matches[1]);

	return ratio;
}

/**
 * Check whether all images are retina.
 *
 * @param  {Array}  images
 * @return {Boolean}
 */
function areAllRetina(images) {
	return lodash.every(images, function(image) {
		return image.retina;
	});
}

/**
 * Simple helper to avoid collisions
 * with group names symbols.
 *
 * @param  {Boolean} toggle
 * @return {Function}
 */
function mask(toggle) {
	var input  = new RegExp('[' + (toggle ? GROUP_DELIMITER : GROUP_MASK) + ']', 'gi');
	var output = toggle ? GROUP_MASK : GROUP_DELIMITER;

	return function(value) {
		return value.replace(input, output);
	}
}

/**
 * Generate a path to the sprite.
 *
 * @param  {Object} opts
 * @param  {Array}  groups
 * @return {String}
 */
function makeSpritePath(opts, groups) {
	var groups = groups || [];
	var base   = path.dirname(opts.spritePath);
	var extname = path.extname(opts.spritePath);
	var file   = path.basename(opts.spritePath, extname);
	var parts;
	if (!groups.length) {
		return opts.spritePath;
	}
	var retinaIndex = -1;
	var retinaItem = '';
	var ret = '';
	groups.forEach(function (item, i) {
		if (/@(\d)x/.test(item)) {
			retinaIndex = i;
			retinaItem = item;
		}
	});
	if (retinaIndex >= 0) {
		groups.splice(retinaIndex, 1);
	}
	parts = file.split('.');
	parts = parts.concat(groups);
	ret = parts.join('_') + retinaItem + extname;
	return path.join(base, ret);
}

/**
 * Check whether the comment is token that
 * should be replaced with CSS declarations.
 *
 * @param  {Object}  comment
 * @return {Boolean}
 */
function isToken(comment) {
	return /@replace/gi.test(comment.toString());
}

/**
 * Return the value for background-image property.
 *
 * @param  {Object} image
 * @return {String}
 */
function getBackgroundImageUrl(image) {
	var template = lodash.template('url(<%= image.spriteRef %>)');

	return template({ image: image });
}

/**
 * Return the value for background-position property.
 *
 * @param  {Object} image
 * @return {String}
 */
function getBackgroundPosition(image, opts) {
	var x,y;
	x = -1 * (image.retina ? image.coordinates.x / image.ratio : image.coordinates.x);
	y = -1 * (image.retina ? image.coordinates.y / image.ratio : image.coordinates.y);
	var template = lodash.template("<%= (x ? x + 'px' : x) %> <%= (y ? y + 'px' : y) %>");
	// px to rem
	//分图片处理 获取 单个images的rootValue
	var rootValue = image.rootValue;
	if( rootValue !== 0 ) {
		x = pxToRem(x, rootValue);
		y = pxToRem(y, rootValue);
		template = lodash.template("<%= (x ? x + 'rem' : x) %> <%= (y? y + 'rem' : y) %>");
	}
	return template({ x: x, y: y });
}

/**
 * Return the value for background-size property.
 *
 * @param  {Object} image
 * @return {String}
 */
function getBackgroundSize(image, opts) {
	var x,y;
	x = image.properties.width / image.ratio;
	y = image.properties.height / image.ratio;	
	var template = lodash.template("<%= x %>px <%= y %>px");

	// px to rem
	//分图片处理 获取 单个images的rootValue
	var rootValue = image.rootValue;
	if (rootValue !== 0) {
		x = pxToRem(x, rootValue);
		y = pxToRem(y, rootValue);
		template = lodash.template("<%= x %>rem <%= y %>rem");
	}

	return template({ x: x, y: y });
}

function getDimensions (image, opts, prop) {
	//分图片处理 获取 单个images的rootValue
	// console.log(image[prop]);
	var rootValue = image.rootValue;
	if (rootValue !== 0) {
		if(image.width){
			return pxToRem(image.retina ? image[prop] / image.ratio : image[prop], rootValue) + 'rem';
		}else{
			return pxToRem(image.retina ? image.coordinates[prop] / image.ratio : image.coordinates[prop], rootValue) + 'rem';
		}
	} else {
		return (image.retina ? image.coordinates[prop] / image.ratio : image.coordinates[prop]) + 'px';
	}
}

function pxToRem (px, rootValue) {
	return px / rootValue;
}