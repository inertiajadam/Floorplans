<?php

namespace App\Support\Inventory;

use RuntimeException;

/**
 * A feed could not be read.
 *
 * Carries a message written for the OPERATOR, not the developer — it is shown
 * in the portal next to their connection settings, and "cURL error 28" helps
 * nobody decide what to do. The original is kept as the previous exception for
 * the log.
 */
class InventorySourceException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly string $kind = 'transport',   // auth | transport | response | config
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }

    public static function auth(string $detail = ''): self
    {
        return new self(
            'Your inventory system rejected our credentials. Check the client id and secret, and that the application is still authorised.' . ($detail ? " ({$detail})" : ''),
            'auth',
        );
    }

    public static function config(string $what): self
    {
        return new self("This connection is not set up yet: {$what}.", 'config');
    }

    public static function response(string $detail): self
    {
        return new self("We reached your inventory system but could not read the response: {$detail}", 'response');
    }
}
