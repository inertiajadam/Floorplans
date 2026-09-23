<?php

namespace App\Support\Inventory;

/**
 * Pairing a feed's units to our suites, once, so every later sync can match
 * on a stable id instead of guessing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCREEN AND NOT A FUNCTION
 * ---------------------------------------------------------------------------
 * Matching on suite number is the bug that marks the wrong room vacant. Numbers
 * get reused when a wing is renumbered; two buildings on one campus both have a
 * "204"; a PMS labels beds "204-A" and "204-B" where we have one suite. None of
 * those throw. They quietly point a family at a room someone lives in.
 *
 * So this class PROPOSES and never decides. It returns scored pairs with the
 * reasoning attached, and a human confirms them. That costs one afternoon,
 * once, and removes an entire class of silent data corruption.
 *
 * Everything here is pure — no Eloquent, no container, no I/O — so it is
 * genuinely unit-testable. See tests/php/matcher_test.php.
 *
 * ---------------------------------------------------------------------------
 * AMBIGUITY IS THE POINT
 * ---------------------------------------------------------------------------
 * A high score is not enough on its own. If feed unit "204" scores 0.95
 * against two of our suites, the top score is meaningless — it is a coin flip.
 * So a pair whose runner-up is close behind is demoted to `low` no matter how
 * well it scored, and bulk-accept never touches it. That single rule is what
 * makes "accept all the confident ones" safe to offer.
 */
final class InventoryMatcher
{
    /** Below this, we do not even propose a pair. */
    public const FLOOR = 0.45;

    /** Bulk-accept only ever touches this band. */
    public const HIGH = 0.90;
    public const MEDIUM = 0.70;

    /** A runner-up this close makes the winner untrustworthy. */
    public const AMBIGUITY_GAP = 0.08;

    /**
     * @param  array<int, FeedUnit|array>  $feedUnits
     * @param  array<int, array{id: int|string, number: string, building?: ?string, level?: ?string}>  $suites
     * @return array{
     *   pairs: array<int, array<string, mixed>>,
     *   unmatchedFeed: array<int, array<string, mixed>>,
     *   unmatchedSuites: array<int, array<string, mixed>>,
     *   counts: array{high: int, medium: int, low: int, unmatchedFeed: int, unmatchedSuites: int}
     * }
     */
    public static function propose(array $feedUnits, array $suites): array
    {
        $feed = array_map(static fn ($f) => self::normaliseFeed($f), $feedUnits);
        $ours = array_map(static fn ($s) => self::normaliseSuite($s), $suites);

        /* Score every pair. A campus is hundreds of units at most, so the
           quadratic pass is a few thousand comparisons — irrelevant, and far
           easier to reason about than an index. */
        $candidates = [];
        foreach ($feed as $fi => $f) {
            foreach ($ours as $si => $s) {
                [$score, $reason] = self::score($f, $s);
                if ($score >= self::FLOOR) {
                    $candidates[] = ['fi' => $fi, 'si' => $si, 'score' => $score, 'reason' => $reason];
                }
            }
        }

        /* Per feed unit, how close is the runner-up? A near-tie means the top
           score tells us nothing, whatever its value. */
        $bestTwo = [];
        foreach ($candidates as $c) {
            $bestTwo[$c['fi']][] = $c['score'];
        }
        foreach ($bestTwo as $fi => $scores) {
            rsort($scores);
            $bestTwo[$fi] = [$scores[0], $scores[1] ?? 0.0];
        }

        usort($candidates, static fn ($a, $b) => $b['score'] <=> $a['score']);

        $takenFeed = [];
        $takenSuite = [];
        $pairs = [];

        foreach ($candidates as $c) {
            if (isset($takenFeed[$c['fi']]) || isset($takenSuite[$c['si']])) {
                continue;
            }
            $takenFeed[$c['fi']] = true;
            $takenSuite[$c['si']] = true;

            [$best, $runnerUp] = $bestTwo[$c['fi']] ?? [$c['score'], 0.0];
            $ambiguous = ($best - $runnerUp) < self::AMBIGUITY_GAP;

            $pairs[] = [
                'externalId' => $feed[$c['fi']]['externalId'],
                'feedLabel'  => $feed[$c['fi']]['label'],
                'feedBuilding' => $feed[$c['fi']]['building'],
                'unitId'     => $ours[$c['si']]['id'],
                'unitNumber' => $ours[$c['si']]['number'],
                'unitBuilding' => $ours[$c['si']]['building'],
                'unitLevel'  => $ours[$c['si']]['level'],
                'score'      => round($c['score'], 3),
                'confidence' => self::band($c['score'], $ambiguous),
                'ambiguous'  => $ambiguous,
                'reason'     => $ambiguous
                    ? $c['reason'] . ', but another suite matches almost as well — check this one'
                    : $c['reason'],
            ];
        }

        $unmatchedFeed = [];
        foreach ($feed as $fi => $f) {
            if (! isset($takenFeed[$fi])) {
                $unmatchedFeed[] = [
                    'externalId' => $f['externalId'],
                    'label'      => $f['label'],
                    'building'   => $f['building'],
                    'floor'      => $f['floor'],
                ];
            }
        }

        $unmatchedSuites = [];
        foreach ($ours as $si => $s) {
            if (! isset($takenSuite[$si])) {
                $unmatchedSuites[] = [
                    'unitId'   => $s['id'],
                    'number'   => $s['number'],
                    'building' => $s['building'],
                    'level'    => $s['level'],
                ];
            }
        }

        $counts = [
            'high'   => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'high')),
            'medium' => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'medium')),
            'low'    => count(array_filter($pairs, static fn ($p) => $p['confidence'] === 'low')),
            'unmatchedFeed'   => count($unmatchedFeed),
            'unmatchedSuites' => count($unmatchedSuites),
        ];

        /* Present in suite order — an operator reviews their own building, not
           the vendor's export order. */
        usort($pairs, static fn ($a, $b) => strnatcasecmp((string) $a['unitNumber'], (string) $b['unitNumber']));

        return compact('pairs', 'unmatchedFeed', 'unmatchedSuites', 'counts');
    }

    /* ---------------------------------------------------------------- scoring */

    /**
     * How well does one feed unit match one suite?
     *
     * @return array{0: float, 1: string} score and the reason shown to the operator
     */
    private static function score(array $f, array $s): array
    {
        $place = self::placeAgreement($f, $s);

        // 1. The labels are literally the same string once punctuation is gone.
        if ($f['norm'] !== '' && $f['norm'] === $s['norm']) {
            return match ($place) {
                'match'    => [1.00, 'Exact number, same building'],
                'unknown'  => [0.93, 'Exact number'],
                'mismatch' => [0.55, 'Exact number, but a different building'],
            };
        }

        // 2. Same digits. "204-A" vs "204", "Rm 204" vs "204".
        if ($f['digits'] !== '' && $f['digits'] === $s['digits']) {
            return match ($place) {
                'match'    => [0.95, 'Same room number, same building'],
                'unknown'  => [0.86, 'Same room number'],
                'mismatch' => [0.50, 'Same room number, but a different building'],
            };
        }

        // 3. One label contains the other as a whole token.
        if (self::containsToken($f['norm'], $s['norm']) || self::containsToken($s['norm'], $f['norm'])) {
            return match ($place) {
                'match'    => [0.80, 'Number appears in the feed label, same building'],
                'unknown'  => [0.72, 'Number appears in the feed label'],
                'mismatch' => [0.47, 'Number appears in the label, but a different building'],
            };
        }

        // 4. Close enough textually to be worth a human look, nothing more.
        similar_text($f['norm'], $s['norm'], $percent);
        if ($percent >= 82 && $f['norm'] !== '' && $s['norm'] !== '') {
            $base = 0.46 + (($percent - 82) / 100);
            return [$place === 'match' ? $base + 0.06 : $base, 'Similar label — worth checking'];
        }

        return [0.0, ''];
    }

    /**
     * Do the two records agree about where the unit is?
     *
     * Returns 'match', 'mismatch' or 'unknown'. 'unknown' when either side has
     * no building information, which is common and must not be punished — a
     * feed that omits buildings is not evidence of a mismatch.
     */
    private static function placeAgreement(array $f, array $s): string
    {
        $a = $f['buildingNorm'];
        $b = $s['buildingNorm'];

        if ($a === '' || $b === '') {
            return 'unknown';
        }
        if ($a === $b) {
            return 'match';
        }
        /* Vendors abbreviate: "MAGNOLIAHOUSE" vs "MAGNOLIA". Treat a clean
           prefix either way as agreement rather than a conflict. */
        if (str_starts_with($a, $b) || str_starts_with($b, $a)) {
            return 'match';
        }

        return 'mismatch';
    }

    /** Is `$needle` present in `$haystack` bounded by non-alphanumerics or string ends? */
    private static function containsToken(string $haystack, string $needle): bool
    {
        if (strlen($needle) < 2 || $haystack === '' || $needle === $haystack) {
            return false;
        }

        return (bool) preg_match('/(?<![A-Z0-9])' . preg_quote($needle, '/') . '(?![A-Z0-9])/', $haystack);
    }

    private static function band(float $score, bool $ambiguous): string
    {
        /* Ambiguity caps the band regardless of score — this is what makes
           "accept all confident matches" safe to offer as one button. */
        if ($ambiguous) {
            return 'low';
        }
        if ($score >= self::HIGH) {
            return 'high';
        }

        return $score >= self::MEDIUM ? 'medium' : 'low';
    }

    /* ------------------------------------------------------------ normalising */

    private static function normaliseFeed(FeedUnit|array $f): array
    {
        $arr = $f instanceof FeedUnit ? $f->toArray() : $f;
        $label = (string) ($arr['label'] ?? '');

        return [
            'externalId'   => (string) ($arr['externalId'] ?? $arr['external_id'] ?? ''),
            'label'        => $label,
            'building'     => $arr['building'] ?? null,
            'floor'        => $arr['floor'] ?? null,
            'norm'         => self::norm($label),
            'digits'       => self::digits($label),
            'buildingNorm' => self::norm((string) ($arr['building'] ?? '')),
        ];
    }

    private static function normaliseSuite(array $s): array
    {
        $number = (string) ($s['number'] ?? '');

        return [
            'id'           => $s['id'] ?? null,
            'number'       => $number,
            'building'     => $s['building'] ?? null,
            'level'        => $s['level'] ?? null,
            'norm'         => self::norm($number),
            'digits'       => self::digits($number),
            'buildingNorm' => self::norm((string) ($s['building'] ?? '')),
        ];
    }

    /** Uppercase alphanumerics only: "Rm 204-A" -> "RM204A". */
    private static function norm(string $v): string
    {
        return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $v) ?? '');
    }

    /**
     * The longest digit run in a label. "204-A" -> "204", "Bldg 2 Rm 1043" ->
     * "1043". Longest rather than first, because vendor labels lead with
     * building and wing numbers far more often than they lead with the room.
     */
    private static function digits(string $v): string
    {
        preg_match_all('/\d+/', $v, $m);
        if (! $m[0]) {
            return '';
        }
        usort($m[0], static fn ($a, $b) => strlen($b) <=> strlen($a));

        return $m[0][0];
    }
}
