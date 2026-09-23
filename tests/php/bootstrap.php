<?php

/*
 | A very small test harness.
 |
 | The inventory logic — matching, status translation, field extraction — is
 | deliberately pure: no Eloquent, no container, no HTTP. That makes it
 | testable without booting Laravel, which means these tests actually run in
 | this repo rather than being aspirational.
 |
 | The parts that CANNOT be tested here are the parts that talk to
 | PointClickCare, because their developer portal is unreachable from this
 | environment. Those are isolated behind InventorySource for exactly that
 | reason: the untestable surface is one HTTP client, and everything that
 | decides anything sits on this side of the line.
 |
 | Run: php tests/php/run.php
 */

$root = dirname(__DIR__, 2);

require_once "{$root}/laravel/Support/Inventory/FeedUnit.php";
require_once "{$root}/laravel/Support/Inventory/StatusMap.php";
require_once "{$root}/laravel/Support/Inventory/InventoryMatcher.php";
require_once "{$root}/laravel/Support/Inventory/PointClickCare/PointClickCareMapper.php";

final class T
{
    public static int $passed = 0;
    public static array $failed = [];
    private static string $group = '';

    public static function group(string $name): void
    {
        self::$group = $name;
        echo "\n  {$name}\n";
    }

    public static function ok(string $what, bool $cond, string $detail = ''): void
    {
        if ($cond) {
            self::$passed++;
            echo "    ok   {$what}" . ($detail ? " — {$detail}" : '') . "\n";

            return;
        }
        self::$failed[] = self::$group . ' / ' . $what;
        echo "   FAIL  {$what}" . ($detail ? " — {$detail}" : '') . "\n";
    }

    public static function same(string $what, mixed $expected, mixed $actual): void
    {
        $pass = $expected === $actual;
        self::ok($what, $pass, $pass ? self::show($actual) : 'expected ' . self::show($expected) . ', got ' . self::show($actual));
    }

    private static function show(mixed $v): string
    {
        return match (true) {
            is_null($v)  => 'null',
            is_bool($v)  => $v ? 'true' : 'false',
            is_array($v) => json_encode($v),
            default      => (string) $v,
        };
    }

    public static function summary(): int
    {
        $total = self::$passed + count(self::$failed);
        echo "\n{$total} assertions, " . self::$passed . " passed";
        if (self::$failed) {
            echo ', ' . count(self::$failed) . " FAILED:\n";
            foreach (self::$failed as $f) {
                echo "  - {$f}\n";
            }

            return 1;
        }
        echo "\n";

        return 0;
    }
}
