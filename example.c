// 简单 C 测试样例：用于内置 C→RV32I 编译器

// 示例 1：标量运算与 return
int main() {
  int a = 10, b = 3, c = 0;
  c = a + b;
  c = c * 2;
  c = c - 5;
  c = c ^ 7;
  return c;
}

// 示例 2：for 循环与数组（注意：for 要带 { } 才被支持）
int main() {
  int sum = 0;
  int a[5];
  a[0] = 1;
  for (int i = 1; i <= 4; i++) {
    a[i] = a[i - 1] + i;
  }
  for (int i = 0; i <= 4; i++) {
    sum += a[i];
  }
  return sum; // 1 + 2 + 4 + 7 + 11 = 25
}

// 示例 3：嵌套 for 与自增
int main() {
  int a = 4, b = 5, c = 0;
  for (int i = 1; i <= a; i++) {
    for (int j = 1; j <= b; j++) {
      c++;
    }
  }
  return c; // 4 * 5 = 20
}

// 示例 4：if 条件 + 逻辑与或（if 也要求带 { }）
int main() {
  int a = 3, b = 5, c = 0;
  if (a < b && b > 0) {
    c++;
  }
  if (a > b || b > 0) {
    c++;
  }
  return c; // 2
}

// 示例 5：数组与混合表达式
int main() {
  int x = 0;
  int v[4];
  v[0] = 1;
  for (int i = 1; i <= 3; i++) {
    v[i] = v[i - 1] * 2 + i;
  }
  for (int i = 0; i <= 3; i++) {
    x += v[i];
  }
  return x;
}

