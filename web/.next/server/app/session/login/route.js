/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "app/session/login/route";
exports.ids = ["app/session/login/route"];
exports.modules = {

/***/ "next/dist/compiled/next-server/app-page.runtime.dev.js":
/*!*************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-page.runtime.dev.js" ***!
  \*************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/app-page.runtime.dev.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-route.runtime.dev.js":
/*!**************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-route.runtime.dev.js" ***!
  \**************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/app-route.runtime.dev.js");

/***/ }),

/***/ "../app-render/work-async-storage.external":
/*!*****************************************************************************!*\
  !*** external "next/dist/server/app-render/work-async-storage.external.js" ***!
  \*****************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/work-async-storage.external.js");

/***/ }),

/***/ "./work-unit-async-storage.external":
/*!**********************************************************************************!*\
  !*** external "next/dist/server/app-render/work-unit-async-storage.external.js" ***!
  \**********************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/work-unit-async-storage.external.js");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fsession%2Flogin%2Froute&page=%2Fsession%2Flogin%2Froute&appPaths=&pagePath=private-next-app-dir%2Fsession%2Flogin%2Froute.ts&appDir=%2Fapp%2Fweb%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2Fapp%2Fweb&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!":
/*!*************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fsession%2Flogin%2Froute&page=%2Fsession%2Flogin%2Froute&appPaths=&pagePath=private-next-app-dir%2Fsession%2Flogin%2Froute.ts&appDir=%2Fapp%2Fweb%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2Fapp%2Fweb&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D! ***!
  \*************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   patchFetch: () => (/* binding */ patchFetch),\n/* harmony export */   routeModule: () => (/* binding */ routeModule),\n/* harmony export */   serverHooks: () => (/* binding */ serverHooks),\n/* harmony export */   workAsyncStorage: () => (/* binding */ workAsyncStorage),\n/* harmony export */   workUnitAsyncStorage: () => (/* binding */ workUnitAsyncStorage)\n/* harmony export */ });\n/* harmony import */ var next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/dist/server/route-modules/app-route/module.compiled */ \"(rsc)/./node_modules/next/dist/server/route-modules/app-route/module.compiled.js\");\n/* harmony import */ var next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_dist_server_route_kind__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/dist/server/route-kind */ \"(rsc)/./node_modules/next/dist/server/route-kind.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/dist/server/lib/patch-fetch */ \"(rsc)/./node_modules/next/dist/server/lib/patch-fetch.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var _app_web_app_session_login_route_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./app/session/login/route.ts */ \"(rsc)/./app/session/login/route.ts\");\n\n\n\n\n// We inject the nextConfigOutput here so that we can use them in the route\n// module.\nconst nextConfigOutput = \"\"\nconst routeModule = new next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__.AppRouteRouteModule({\n    definition: {\n        kind: next_dist_server_route_kind__WEBPACK_IMPORTED_MODULE_1__.RouteKind.APP_ROUTE,\n        page: \"/session/login/route\",\n        pathname: \"/session/login\",\n        filename: \"route\",\n        bundlePath: \"app/session/login/route\"\n    },\n    resolvedPagePath: \"/app/web/app/session/login/route.ts\",\n    nextConfigOutput,\n    userland: _app_web_app_session_login_route_ts__WEBPACK_IMPORTED_MODULE_3__\n});\n// Pull out the exports that we need to expose from the module. This should\n// be eliminated when we've moved the other routes to the new format. These\n// are used to hook into the route.\nconst { workAsyncStorage, workUnitAsyncStorage, serverHooks } = routeModule;\nfunction patchFetch() {\n    return (0,next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__.patchFetch)({\n        workAsyncStorage,\n        workUnitAsyncStorage\n    });\n}\n\n\n//# sourceMappingURL=app-route.js.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbmV4dC9kaXN0L2J1aWxkL3dlYnBhY2svbG9hZGVycy9uZXh0LWFwcC1sb2FkZXIvaW5kZXguanM/bmFtZT1hcHAlMkZzZXNzaW9uJTJGbG9naW4lMkZyb3V0ZSZwYWdlPSUyRnNlc3Npb24lMkZsb2dpbiUyRnJvdXRlJmFwcFBhdGhzPSZwYWdlUGF0aD1wcml2YXRlLW5leHQtYXBwLWRpciUyRnNlc3Npb24lMkZsb2dpbiUyRnJvdXRlLnRzJmFwcERpcj0lMkZhcHAlMkZ3ZWIlMkZhcHAmcGFnZUV4dGVuc2lvbnM9dHN4JnBhZ2VFeHRlbnNpb25zPXRzJnBhZ2VFeHRlbnNpb25zPWpzeCZwYWdlRXh0ZW5zaW9ucz1qcyZyb290RGlyPSUyRmFwcCUyRndlYiZpc0Rldj10cnVlJnRzY29uZmlnUGF0aD10c2NvbmZpZy5qc29uJmJhc2VQYXRoPSZhc3NldFByZWZpeD0mbmV4dENvbmZpZ091dHB1dD0mcHJlZmVycmVkUmVnaW9uPSZtaWRkbGV3YXJlQ29uZmlnPWUzMCUzRCEiLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7QUFBK0Y7QUFDdkM7QUFDcUI7QUFDYjtBQUNoRTtBQUNBO0FBQ0E7QUFDQSx3QkFBd0IseUdBQW1CO0FBQzNDO0FBQ0EsY0FBYyxrRUFBUztBQUN2QjtBQUNBO0FBQ0E7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUNBO0FBQ0EsWUFBWTtBQUNaLENBQUM7QUFDRDtBQUNBO0FBQ0E7QUFDQSxRQUFRLHNEQUFzRDtBQUM5RDtBQUNBLFdBQVcsNEVBQVc7QUFDdEI7QUFDQTtBQUNBLEtBQUs7QUFDTDtBQUMwRjs7QUFFMUYiLCJzb3VyY2VzIjpbIiJdLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBcHBSb3V0ZVJvdXRlTW9kdWxlIH0gZnJvbSBcIm5leHQvZGlzdC9zZXJ2ZXIvcm91dGUtbW9kdWxlcy9hcHAtcm91dGUvbW9kdWxlLmNvbXBpbGVkXCI7XG5pbXBvcnQgeyBSb3V0ZUtpbmQgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9yb3V0ZS1raW5kXCI7XG5pbXBvcnQgeyBwYXRjaEZldGNoIGFzIF9wYXRjaEZldGNoIH0gZnJvbSBcIm5leHQvZGlzdC9zZXJ2ZXIvbGliL3BhdGNoLWZldGNoXCI7XG5pbXBvcnQgKiBhcyB1c2VybGFuZCBmcm9tIFwiL2FwcC93ZWIvYXBwL3Nlc3Npb24vbG9naW4vcm91dGUudHNcIjtcbi8vIFdlIGluamVjdCB0aGUgbmV4dENvbmZpZ091dHB1dCBoZXJlIHNvIHRoYXQgd2UgY2FuIHVzZSB0aGVtIGluIHRoZSByb3V0ZVxuLy8gbW9kdWxlLlxuY29uc3QgbmV4dENvbmZpZ091dHB1dCA9IFwiXCJcbmNvbnN0IHJvdXRlTW9kdWxlID0gbmV3IEFwcFJvdXRlUm91dGVNb2R1bGUoe1xuICAgIGRlZmluaXRpb246IHtcbiAgICAgICAga2luZDogUm91dGVLaW5kLkFQUF9ST1VURSxcbiAgICAgICAgcGFnZTogXCIvc2Vzc2lvbi9sb2dpbi9yb3V0ZVwiLFxuICAgICAgICBwYXRobmFtZTogXCIvc2Vzc2lvbi9sb2dpblwiLFxuICAgICAgICBmaWxlbmFtZTogXCJyb3V0ZVwiLFxuICAgICAgICBidW5kbGVQYXRoOiBcImFwcC9zZXNzaW9uL2xvZ2luL3JvdXRlXCJcbiAgICB9LFxuICAgIHJlc29sdmVkUGFnZVBhdGg6IFwiL2FwcC93ZWIvYXBwL3Nlc3Npb24vbG9naW4vcm91dGUudHNcIixcbiAgICBuZXh0Q29uZmlnT3V0cHV0LFxuICAgIHVzZXJsYW5kXG59KTtcbi8vIFB1bGwgb3V0IHRoZSBleHBvcnRzIHRoYXQgd2UgbmVlZCB0byBleHBvc2UgZnJvbSB0aGUgbW9kdWxlLiBUaGlzIHNob3VsZFxuLy8gYmUgZWxpbWluYXRlZCB3aGVuIHdlJ3ZlIG1vdmVkIHRoZSBvdGhlciByb3V0ZXMgdG8gdGhlIG5ldyBmb3JtYXQuIFRoZXNlXG4vLyBhcmUgdXNlZCB0byBob29rIGludG8gdGhlIHJvdXRlLlxuY29uc3QgeyB3b3JrQXN5bmNTdG9yYWdlLCB3b3JrVW5pdEFzeW5jU3RvcmFnZSwgc2VydmVySG9va3MgfSA9IHJvdXRlTW9kdWxlO1xuZnVuY3Rpb24gcGF0Y2hGZXRjaCgpIHtcbiAgICByZXR1cm4gX3BhdGNoRmV0Y2goe1xuICAgICAgICB3b3JrQXN5bmNTdG9yYWdlLFxuICAgICAgICB3b3JrVW5pdEFzeW5jU3RvcmFnZVxuICAgIH0pO1xufVxuZXhwb3J0IHsgcm91dGVNb2R1bGUsIHdvcmtBc3luY1N0b3JhZ2UsIHdvcmtVbml0QXN5bmNTdG9yYWdlLCBzZXJ2ZXJIb29rcywgcGF0Y2hGZXRjaCwgIH07XG5cbi8vIyBzb3VyY2VNYXBwaW5nVVJMPWFwcC1yb3V0ZS5qcy5tYXAiXSwibmFtZXMiOltdLCJpZ25vcmVMaXN0IjpbXSwic291cmNlUm9vdCI6IiJ9\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fsession%2Flogin%2Froute&page=%2Fsession%2Flogin%2Froute&appPaths=&pagePath=private-next-app-dir%2Fsession%2Flogin%2Froute.ts&appDir=%2Fapp%2Fweb%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2Fapp%2Fweb&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!\n");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true!":
/*!******************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true! ***!
  \******************************************************************************************************/
/***/ (() => {



/***/ }),

/***/ "(ssr)/./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true!":
/*!******************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true! ***!
  \******************************************************************************************************/
/***/ (() => {



/***/ }),

/***/ "(rsc)/./app/session/login/route.ts":
/*!************************************!*\
  !*** ./app/session/login/route.ts ***!
  \************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   POST: () => (/* binding */ POST)\n/* harmony export */ });\n/* harmony import */ var next_server__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/server */ \"(rsc)/./node_modules/next/dist/api/server.js\");\n\nconst API_BASE = process.env.API_BASE_URL || 'http://localhost:8001';\nconst AUTH_COOKIE = process.env.AUTH_COOKIE_NAME || 'lumascout_session';\nconst COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days\nasync function POST(req) {\n    let body = {};\n    try {\n        body = await req.json();\n    } catch  {\n        body = {};\n    }\n    const { email, password } = body;\n    if (!email || !password) {\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: 'Email and password are required.'\n        }, {\n            status: 400\n        });\n    }\n    let upstream;\n    try {\n        upstream = await fetch(`${API_BASE}/api/auth/login`, {\n            method: 'POST',\n            headers: {\n                'Content-Type': 'application/json',\n                Accept: 'application/json'\n            },\n            body: JSON.stringify({\n                email,\n                password\n            }),\n            cache: 'no-store'\n        });\n    } catch (e) {\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: 'Auth server unreachable.'\n        }, {\n            status: 502\n        });\n    }\n    const text = await upstream.text();\n    let data = {};\n    try {\n        data = text ? JSON.parse(text) : {};\n    } catch  {\n        data = {\n            raw: text\n        };\n    }\n    if (!upstream.ok) {\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: data?.detail || 'Invalid credentials.'\n        }, {\n            status: upstream.status || 401\n        });\n    }\n    const token = data?.token;\n    if (!token) {\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: 'Malformed auth response.'\n        }, {\n            status: 502\n        });\n    }\n    const res = next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n        user: data.user || null,\n        ok: true\n    });\n    res.cookies.set(AUTH_COOKIE, token, {\n        httpOnly: true,\n        secure: \"development\" === 'production',\n        sameSite: 'lax',\n        path: '/',\n        maxAge: COOKIE_MAX_AGE\n    });\n    return res;\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9hcHAvc2Vzc2lvbi9sb2dpbi9yb3V0ZS50cyIsIm1hcHBpbmdzIjoiOzs7OztBQUF3RDtBQUV4RCxNQUFNQyxXQUFXQyxRQUFRQyxHQUFHLENBQUNDLFlBQVksSUFBSTtBQUM3QyxNQUFNQyxjQUFjSCxRQUFRQyxHQUFHLENBQUNHLGdCQUFnQixJQUFJO0FBQ3BELE1BQU1DLGlCQUFpQixLQUFLLEtBQUssS0FBSyxJQUFJLFVBQVU7QUFFN0MsZUFBZUMsS0FBS0MsR0FBZ0I7SUFDekMsSUFBSUMsT0FBWSxDQUFDO0lBQ2pCLElBQUk7UUFBRUEsT0FBTyxNQUFNRCxJQUFJRSxJQUFJO0lBQUksRUFBRSxPQUFNO1FBQUVELE9BQU8sQ0FBQztJQUFHO0lBQ3BELE1BQU0sRUFBRUUsS0FBSyxFQUFFQyxRQUFRLEVBQUUsR0FBR0g7SUFDNUIsSUFBSSxDQUFDRSxTQUFTLENBQUNDLFVBQVU7UUFDdkIsT0FBT2IscURBQVlBLENBQUNXLElBQUksQ0FBQztZQUFFRyxPQUFPO1FBQW1DLEdBQUc7WUFBRUMsUUFBUTtRQUFJO0lBQ3hGO0lBRUEsSUFBSUM7SUFDSixJQUFJO1FBQ0ZBLFdBQVcsTUFBTUMsTUFBTSxHQUFHaEIsU0FBUyxlQUFlLENBQUMsRUFBRTtZQUNuRGlCLFFBQVE7WUFDUkMsU0FBUztnQkFBRSxnQkFBZ0I7Z0JBQW9CQyxRQUFRO1lBQW1CO1lBQzFFVixNQUFNVyxLQUFLQyxTQUFTLENBQUM7Z0JBQUVWO2dCQUFPQztZQUFTO1lBQ3ZDVSxPQUFPO1FBQ1Q7SUFDRixFQUFFLE9BQU9DLEdBQVE7UUFDZixPQUFPeEIscURBQVlBLENBQUNXLElBQUksQ0FBQztZQUFFRyxPQUFPO1FBQTJCLEdBQUc7WUFBRUMsUUFBUTtRQUFJO0lBQ2hGO0lBRUEsTUFBTVUsT0FBTyxNQUFNVCxTQUFTUyxJQUFJO0lBQ2hDLElBQUlDLE9BQVksQ0FBQztJQUNqQixJQUFJO1FBQUVBLE9BQU9ELE9BQU9KLEtBQUtNLEtBQUssQ0FBQ0YsUUFBUSxDQUFDO0lBQUcsRUFBRSxPQUFNO1FBQUVDLE9BQU87WUFBRUUsS0FBS0g7UUFBSztJQUFHO0lBRTNFLElBQUksQ0FBQ1QsU0FBU2EsRUFBRSxFQUFFO1FBQ2hCLE9BQU83QixxREFBWUEsQ0FBQ1csSUFBSSxDQUN0QjtZQUFFRyxPQUFPWSxNQUFNSSxVQUFVO1FBQXVCLEdBQ2hEO1lBQUVmLFFBQVFDLFNBQVNELE1BQU0sSUFBSTtRQUFJO0lBRXJDO0lBRUEsTUFBTWdCLFFBQTRCTCxNQUFNSztJQUN4QyxJQUFJLENBQUNBLE9BQU87UUFDVixPQUFPL0IscURBQVlBLENBQUNXLElBQUksQ0FBQztZQUFFRyxPQUFPO1FBQTJCLEdBQUc7WUFBRUMsUUFBUTtRQUFJO0lBQ2hGO0lBRUEsTUFBTWlCLE1BQU1oQyxxREFBWUEsQ0FBQ1csSUFBSSxDQUFDO1FBQUVzQixNQUFNUCxLQUFLTyxJQUFJLElBQUk7UUFBTUosSUFBSTtJQUFLO0lBQ2xFRyxJQUFJRSxPQUFPLENBQUNDLEdBQUcsQ0FBQzlCLGFBQWEwQixPQUFPO1FBQ2xDSyxVQUFVO1FBQ1ZDLFFBQVFuQyxrQkFBeUI7UUFDakNvQyxVQUFVO1FBQ1ZDLE1BQU07UUFDTkMsUUFBUWpDO0lBQ1Y7SUFDQSxPQUFPeUI7QUFDVCIsInNvdXJjZXMiOlsiL2FwcC93ZWIvYXBwL3Nlc3Npb24vbG9naW4vcm91dGUudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgTmV4dFJlcXVlc3QsIE5leHRSZXNwb25zZSB9IGZyb20gJ25leHQvc2VydmVyJztcblxuY29uc3QgQVBJX0JBU0UgPSBwcm9jZXNzLmVudi5BUElfQkFTRV9VUkwgfHwgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMSc7XG5jb25zdCBBVVRIX0NPT0tJRSA9IHByb2Nlc3MuZW52LkFVVEhfQ09PS0lFX05BTUUgfHwgJ2x1bWFzY291dF9zZXNzaW9uJztcbmNvbnN0IENPT0tJRV9NQVhfQUdFID0gNjAgKiA2MCAqIDI0ICogMzA7IC8vIDMwIGRheXNcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIFBPU1QocmVxOiBOZXh0UmVxdWVzdCkge1xuICBsZXQgYm9keTogYW55ID0ge307XG4gIHRyeSB7IGJvZHkgPSBhd2FpdCByZXEuanNvbigpOyB9IGNhdGNoIHsgYm9keSA9IHt9OyB9XG4gIGNvbnN0IHsgZW1haWwsIHBhc3N3b3JkIH0gPSBib2R5O1xuICBpZiAoIWVtYWlsIHx8ICFwYXNzd29yZCkge1xuICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IGVycm9yOiAnRW1haWwgYW5kIHBhc3N3b3JkIGFyZSByZXF1aXJlZC4nIH0sIHsgc3RhdHVzOiA0MDAgfSk7XG4gIH1cblxuICBsZXQgdXBzdHJlYW06IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHVwc3RyZWFtID0gYXdhaXQgZmV0Y2goYCR7QVBJX0JBU0V9L2FwaS9hdXRoL2xvZ2luYCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsIEFjY2VwdDogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVtYWlsLCBwYXNzd29yZCB9KSxcbiAgICAgIGNhY2hlOiAnbm8tc3RvcmUnLFxuICAgIH0pO1xuICB9IGNhdGNoIChlOiBhbnkpIHtcbiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogJ0F1dGggc2VydmVyIHVucmVhY2hhYmxlLicgfSwgeyBzdGF0dXM6IDUwMiB9KTtcbiAgfVxuXG4gIGNvbnN0IHRleHQgPSBhd2FpdCB1cHN0cmVhbS50ZXh0KCk7XG4gIGxldCBkYXRhOiBhbnkgPSB7fTtcbiAgdHJ5IHsgZGF0YSA9IHRleHQgPyBKU09OLnBhcnNlKHRleHQpIDoge307IH0gY2F0Y2ggeyBkYXRhID0geyByYXc6IHRleHQgfTsgfVxuXG4gIGlmICghdXBzdHJlYW0ub2spIHtcbiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oXG4gICAgICB7IGVycm9yOiBkYXRhPy5kZXRhaWwgfHwgJ0ludmFsaWQgY3JlZGVudGlhbHMuJyB9LFxuICAgICAgeyBzdGF0dXM6IHVwc3RyZWFtLnN0YXR1cyB8fCA0MDEgfSxcbiAgICApO1xuICB9XG5cbiAgY29uc3QgdG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZCA9IGRhdGE/LnRva2VuO1xuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6ICdNYWxmb3JtZWQgYXV0aCByZXNwb25zZS4nIH0sIHsgc3RhdHVzOiA1MDIgfSk7XG4gIH1cblxuICBjb25zdCByZXMgPSBOZXh0UmVzcG9uc2UuanNvbih7IHVzZXI6IGRhdGEudXNlciB8fCBudWxsLCBvazogdHJ1ZSB9KTtcbiAgcmVzLmNvb2tpZXMuc2V0KEFVVEhfQ09PS0lFLCB0b2tlbiwge1xuICAgIGh0dHBPbmx5OiB0cnVlLFxuICAgIHNlY3VyZTogcHJvY2Vzcy5lbnYuTk9ERV9FTlYgPT09ICdwcm9kdWN0aW9uJyxcbiAgICBzYW1lU2l0ZTogJ2xheCcsXG4gICAgcGF0aDogJy8nLFxuICAgIG1heEFnZTogQ09PS0lFX01BWF9BR0UsXG4gIH0pO1xuICByZXR1cm4gcmVzO1xufVxuIl0sIm5hbWVzIjpbIk5leHRSZXNwb25zZSIsIkFQSV9CQVNFIiwicHJvY2VzcyIsImVudiIsIkFQSV9CQVNFX1VSTCIsIkFVVEhfQ09PS0lFIiwiQVVUSF9DT09LSUVfTkFNRSIsIkNPT0tJRV9NQVhfQUdFIiwiUE9TVCIsInJlcSIsImJvZHkiLCJqc29uIiwiZW1haWwiLCJwYXNzd29yZCIsImVycm9yIiwic3RhdHVzIiwidXBzdHJlYW0iLCJmZXRjaCIsIm1ldGhvZCIsImhlYWRlcnMiLCJBY2NlcHQiLCJKU09OIiwic3RyaW5naWZ5IiwiY2FjaGUiLCJlIiwidGV4dCIsImRhdGEiLCJwYXJzZSIsInJhdyIsIm9rIiwiZGV0YWlsIiwidG9rZW4iLCJyZXMiLCJ1c2VyIiwiY29va2llcyIsInNldCIsImh0dHBPbmx5Iiwic2VjdXJlIiwic2FtZVNpdGUiLCJwYXRoIiwibWF4QWdlIl0sImlnbm9yZUxpc3QiOltdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./app/session/login/route.ts\n");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next"], () => (__webpack_exec__("(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fsession%2Flogin%2Froute&page=%2Fsession%2Flogin%2Froute&appPaths=&pagePath=private-next-app-dir%2Fsession%2Flogin%2Froute.ts&appDir=%2Fapp%2Fweb%2Fapp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=%2Fapp%2Fweb&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!")));
module.exports = __webpack_exports__;

})();