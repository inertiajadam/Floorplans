<?php

namespace App\Support\Inventory\PointClickCare;

use App\Support\Inventory\InventorySourceException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * HTTP and OAuth against PointClickCare.
 *
 * The only class in the inventory feature that talks to the network, and
 * deliberately the only one that makes no decisions. It fetches records and
 * hands them over; what they mean is PointClickCareMapper's problem, and what
 * to do about them is MapInventory's.
 *
 * That split exists because this is the one part that CANNOT be tested from
 * here — developer.pointclickcare.com is unreachable from this environment, so
 * the paths and auth shape in config/inventory.php are informed guesses. By
 * keeping every judgement out of this class, a wrong guess costs a config edit
 * rather than a debugging session through business logic.
 *
 * Everything that can go wrong surfaces as InventorySourceException with a
 * message written for the operator, because that is who reads it.
 */
final class PointClickCareClient
{
    public function __construct(private readonly array $config)
    {
    }

    /**
     * Every record for one facility, following pagination.
     *
     * @return array<int, array<string, mixed>>
     */
    public function units(string $orgId, string $facilityId): array
    {
        $path = str_replace(
            ['{org}', '{facility}'],
            [rawurlencode($orgId), rawurlencode($facilityId)],
            (string) ($this->config['units_path'] ?? ''),
        );

        if ($path === '') {
            throw InventorySourceException::config('no units endpoint is configured');
        }

        $paging = $this->config['pagination'] ?? [];
        $pageSize = (int) ($paging['page_size'] ?? 200);
        $maxPages = (int) ($paging['max_pages'] ?? 50);

        $rows = [];
        $page = 1;
        $cursor = null;

        do {
            $query = [];
            if (! empty($paging['size_param'])) {
                $query[$paging['size_param']] = $pageSize;
            }
            if ($cursor !== null) {
                $query['cursor'] = $cursor;
            } elseif (! empty($paging['page_param'])) {
                $query[$paging['page_param']] = $page;
            }

            $body = $this->get($path, $query);
            $batch = $this->collection($body);
            $rows = array_merge($rows, $batch);

            $cursor = self::dot($body, $paging['next_key'] ?? null);
            $page++;

            /* Stop on an empty page as well as on a missing cursor: an API
               that always returns a next link would otherwise loop to
               max_pages every night. */
        } while ($batch !== [] && ($cursor !== null || count($batch) === $pageSize) && $page <= $maxPages);

        return $rows;
    }

    /**
     * A cheap read used by the connection test. Same endpoint, one small page,
     * so a test proves auth AND the field map without pulling a whole campus.
     *
     * @return array<int, array<string, mixed>>
     */
    public function sample(string $orgId, string $facilityId, int $limit = 25): array
    {
        $path = str_replace(
            ['{org}', '{facility}'],
            [rawurlencode($orgId), rawurlencode($facilityId)],
            (string) ($this->config['units_path'] ?? ''),
        );

        if ($path === '') {
            throw InventorySourceException::config('no units endpoint is configured');
        }

        $paging = $this->config['pagination'] ?? [];
        $query = [];
        if (! empty($paging['size_param'])) {
            $query[$paging['size_param']] = $limit;
        }

        return array_slice($this->collection($this->get($path, $query)), 0, $limit);
    }

    /* ------------------------------------------------------------- transport */

    private function get(string $path, array $query = []): array
    {
        $base = rtrim((string) ($this->config['base_url'] ?? ''), '/');
        if ($base === '') {
            throw InventorySourceException::config('no base URL is configured');
        }

        try {
            $response = Http::withToken($this->token())
                ->acceptJson()
                ->timeout((int) ($this->config['timeout'] ?? 20))
                ->retry(2, 400, throw: false)
                ->get($base . '/' . ltrim($path, '/'), $query);
        } catch (Throwable $e) {
            throw new InventorySourceException(
                'We could not reach your inventory system. It may be temporarily unavailable.',
                'transport',
                $e,
            );
        }

        if ($response->status() === 401 || $response->status() === 403) {
            /* A rejected token is usually a revoked application rather than a
               transient failure, so drop the cached one — retrying with it
               would fail identically for the rest of the hour. */
            Cache::forget($this->tokenCacheKey());
            throw InventorySourceException::auth('HTTP ' . $response->status());
        }

        if ($response->status() === 429) {
            throw new InventorySourceException(
                'Your inventory system asked us to slow down. The next scheduled sync will try again.',
                'transport',
            );
        }

        if (! $response->successful()) {
            throw InventorySourceException::response('HTTP ' . $response->status());
        }

        $json = $response->json();
        if (! is_array($json)) {
            throw InventorySourceException::response('the response was not JSON');
        }

        return $json;
    }

    /**
     * OAuth2 client credentials, cached just inside a conservative lifetime.
     *
     * Cached per client id so several communities on one application share a
     * token rather than each requesting their own — vendors rate-limit token
     * endpoints harder than data endpoints.
     */
    private function token(): string
    {
        $key = $this->tokenCacheKey();
        $cached = Cache::get($key);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $id = (string) ($this->config['client_id'] ?? '');
        $secret = (string) ($this->config['client_secret'] ?? '');
        $tokenUrl = (string) ($this->config['token_url'] ?? '');

        if ($id === '' || $secret === '' || $tokenUrl === '') {
            throw InventorySourceException::config('the PointClickCare application credentials are missing');
        }

        try {
            $response = Http::asForm()
                ->withBasicAuth($id, $secret)
                ->timeout((int) ($this->config['timeout'] ?? 20))
                ->post($tokenUrl, array_filter([
                    'grant_type' => 'client_credentials',
                    'scope'      => $this->config['scope'] ?: null,
                ]));
        } catch (Throwable $e) {
            throw new InventorySourceException('We could not reach your inventory system to sign in.', 'transport', $e);
        }

        if (! $response->successful()) {
            throw InventorySourceException::auth('token endpoint returned HTTP ' . $response->status());
        }

        $token = (string) ($response->json('access_token') ?? '');
        if ($token === '') {
            throw InventorySourceException::auth('no access token in the response');
        }

        /* Expire a minute early so a token never dies mid-request. */
        $ttl = max(60, (int) ($response->json('expires_in') ?? 3600) - 60);
        Cache::put($key, $token, $ttl);

        return $token;
    }

    private function tokenCacheKey(): string
    {
        return 'inventory:pcc:token:' . md5((string) ($this->config['client_id'] ?? '') . '|' . (string) ($this->config['token_url'] ?? ''));
    }

    /** Pull the record array out of whatever envelope the response uses. */
    private function collection(array $body): array
    {
        $key = $this->config['collection_key'] ?? '';
        $rows = $key === '' ? $body : self::dot($body, $key);

        if (! is_array($rows)) {
            return [];
        }

        /* A single record returned unwrapped still counts as one row. */
        return array_is_list($rows) ? $rows : [$rows];
    }

    private static function dot(array $arr, ?string $path): mixed
    {
        if ($path === null || $path === '') {
            return null;
        }
        $value = $arr;
        foreach (explode('.', $path) as $segment) {
            if (! is_array($value) || ! array_key_exists($segment, $value)) {
                return null;
            }
            $value = $value[$segment];
        }

        return $value;
    }
}
