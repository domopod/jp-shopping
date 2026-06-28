CREATE DATABASE IF NOT EXISTS `jp_shopping` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `jp_shopping`;

CREATE TABLE IF NOT EXISTS `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source_url` VARCHAR(1024) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `price` VARCHAR(64) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `size_info` TEXT DEFAULT NULL,
  `specification` TEXT DEFAULT NULL,
  `brand` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT '草稿',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_products_source_url` (`source_url`(255))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_images` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `image_url` TEXT NOT NULL,
  `is_cover` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_product_images_product_id` (`product_id`),
  CONSTRAINT `fk_product_images_product_id`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `product_skus` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `sku_code` VARCHAR(128) NOT NULL,
  `name` VARCHAR(255) DEFAULT NULL,
  `color` VARCHAR(128) DEFAULT NULL,
  `size` VARCHAR(128) DEFAULT NULL,
  `price` VARCHAR(64) DEFAULT NULL,
  `image_url` VARCHAR(1024) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_product_skus_product_id` (`product_id`),
  KEY `idx_product_skus_sku_code` (`sku_code`),
  CONSTRAINT `fk_product_skus_product_id`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
