<?php

namespace App\Support\Inventory;

use App\Support\Inventory\PointClickCare\PointClickCareAdapter;

/**
 * Which inventory sources exist, and how to build one.
 *
 * A registry rather than a container binding because the set is small, static,
 * and the lookup needs to work from a console command, a controller and a
 * queued job without any of them knowing the others exist.
 *
 * Adding a provider is: write the adapter, add one line here, add a config
 * block. Nothing else in the codebase learns its name.
 */
final class InventorySources
{
    /**
     * Provider key => factory.
     *
     * @return array<string, callable(array): InventorySource>
     */
    private static function factories(): array
    {
        return [
            PointClickCareAdapter::KEY => static fn (array $config) => new PointClickCareAdapter($config),
        ];
    }

    public static function make(string $provider): InventorySource
    {
        $factories = self::factories();
        if (! isset($factories[$provider])) {
            throw InventorySourceException::config("'{$provider}' is not an inventory system we support");
        }

        $config = (array) config("inventory.providers.{$provider}", []);
        if ($config === []) {
            throw InventorySourceException::config("'{$provider}' has no configuration");
        }

        return $factories[$provider]($config);
    }

    /**
     * What an operator can choose from. Only providers whose application
     * credentials are actually configured — offering one we cannot
     * authenticate against just produces a confusing failure later.
     *
     * @return array<int, array{key: string, label: string}>
     */
    public static function available(): array
    {
        $out = [];
        foreach (array_keys(self::factories()) as $key) {
            $config = (array) config("inventory.providers.{$key}", []);
            if (empty($config['client_id']) || empty($config['client_secret'])) {
                continue;
            }
            $out[] = ['key' => $key, 'label' => (string) ($config['label'] ?? $key)];
        }

        return $out;
    }

    public static function isConfigured(string $provider): bool
    {
        $config = (array) config("inventory.providers.{$provider}", []);

        return ! empty($config['client_id']) && ! empty($config['client_secret']);
    }
}
