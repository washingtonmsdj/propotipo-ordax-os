#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef EXT4_SUPER_MAGIC
#define EXT4_SUPER_MAGIC 0xEF53
#endif

#define EXT4_DISK_SUPER_OFFSET 1024
#define EXT4_DISK_SUPER_BYTES 1024
#define EXT4_INCOMPAT_64BIT 0x80U
#define EXT4_RO_COMPAT_BIGALLOC 0x200U

/* ext4 on-disk superblock offsets; see Documentation/filesystems/ext4/super.rst. */
#define EXT4_SB_BLOCKS_COUNT_LO 0x04
#define EXT4_SB_FIRST_DATA_BLOCK 0x14
#define EXT4_SB_LOG_BLOCK_SIZE 0x18
#define EXT4_SB_BLOCKS_PER_GROUP 0x20
#define EXT4_SB_MAGIC 0x38
#define EXT4_SB_FEATURE_INCOMPAT 0x60
#define EXT4_SB_FEATURE_RO_COMPAT 0x64
#define EXT4_SB_BLOCKS_COUNT_HI 0x150

/*
 * Keep the fixed initramfs self-contained: musl-gcc does not ship Linux UAPI
 * headers on every builder. These are stable Linux UAPI request definitions:
 *   BLKGETSIZE64       _IOR(0x12, 114, size_t)
 *   EXT4_IOC_RESIZE_FS _IOW('f', 16, __u64)
 * The argument storage remains an explicit uint64_t in both cases.
 */
#ifndef BLKGETSIZE64
#define BLKGETSIZE64 _IOR(0x12, 114, size_t)
#endif

#ifndef EXT4_IOC_RESIZE_FS
#define EXT4_IOC_RESIZE_FS _IOW('f', 16, uint64_t)
#endif

_Static_assert(sizeof(uint64_t) == 8, "uint64_t must be 64-bit");

struct ext4_disk_info {
    uint64_t blocks_count;
    uint64_t block_size;
    uint32_t blocks_per_group;
    uint32_t first_data_block;
};

static void fail_errno(const char *message) {
    fprintf(stderr, "ordax-grow-ext4: %s: %s\n", message, strerror(errno));
    exit(1);
}

static void fail(const char *message) {
    fprintf(stderr, "ordax-grow-ext4: %s\n", message);
    exit(1);
}

static uint16_t read_le16(const unsigned char *p) {
    return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t read_le32(const unsigned char *p) {
    return (uint32_t)p[0] |
           ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

static struct stat require_block_device(const char *path) {
    struct stat st;
    if (lstat(path, &st) != 0) {
        fail_errno("cannot inspect ORDAX block device");
    }
    if (!S_ISBLK(st.st_mode)) {
        fail("source is not a block device");
    }
    return st;
}

static struct stat require_mountpoint_directory(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        fail_errno("cannot inspect ORDAX mountpoint");
    }
    if (!S_ISDIR(st.st_mode)) {
        fail("mountpoint is not a directory");
    }
    return st;
}

static struct ext4_disk_info read_ext4_disk_info(int fd) {
    unsigned char raw[EXT4_DISK_SUPER_BYTES];
    ssize_t got = pread(fd, raw, sizeof(raw), EXT4_DISK_SUPER_OFFSET);
    if (got < 0) {
        fail_errno("cannot read ext4 superblock");
    }
    if ((size_t)got != sizeof(raw)) {
        fail("ext4 superblock read was truncated");
    }
    if (read_le16(raw + EXT4_SB_MAGIC) != EXT4_SUPER_MAGIC) {
        fail("block device does not contain an ext4 primary superblock");
    }

    uint32_t log_block_size = read_le32(raw + EXT4_SB_LOG_BLOCK_SIZE);
    if (log_block_size > 6) {
        fail("ext4 superblock declares an unsupported block size");
    }

    uint32_t incompat = read_le32(raw + EXT4_SB_FEATURE_INCOMPAT);
    uint32_t ro_compat = read_le32(raw + EXT4_SB_FEATURE_RO_COMPAT);
    if ((ro_compat & EXT4_RO_COMPAT_BIGALLOC) != 0) {
        fail("bigalloc ext4 is not supported by the fixed growth helper");
    }

    uint64_t blocks = read_le32(raw + EXT4_SB_BLOCKS_COUNT_LO);
    if ((incompat & EXT4_INCOMPAT_64BIT) != 0) {
        blocks |= (uint64_t)read_le32(raw + EXT4_SB_BLOCKS_COUNT_HI) << 32;
    }

    struct ext4_disk_info info = {
        .blocks_count = blocks,
        .block_size = 1024ULL << log_block_size,
        .blocks_per_group = read_le32(raw + EXT4_SB_BLOCKS_PER_GROUP),
        .first_data_block = read_le32(raw + EXT4_SB_FIRST_DATA_BLOCK),
    };
    if (info.blocks_count == 0 || info.blocks_per_group == 0) {
        fail("ext4 superblock contains invalid sizing metadata");
    }
    return info;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: ordax-grow-ext4 BLOCK_DEVICE MOUNTPOINT\n");
        return 2;
    }

    const char *device = argv[1];
    const char *mountpoint = argv[2];
    struct stat device_stat = require_block_device(device);
    struct stat mount_stat = require_mountpoint_directory(mountpoint);
    if (mount_stat.st_dev != device_stat.st_rdev) {
        fail("mountpoint does not belong to the supplied block device");
    }

    struct statvfs mount_flags;
    if (statvfs(mountpoint, &mount_flags) != 0) {
        fail_errno("cannot inspect ORDAX mount flags");
    }
    if ((mount_flags.f_flag & ST_RDONLY) != 0) {
        fail("mounted filesystem is read-only");
    }

    struct statfs mounted;
    if (statfs(mountpoint, &mounted) != 0) {
        fail_errno("cannot inspect mounted filesystem");
    }
    if ((unsigned long)mounted.f_type != (unsigned long)EXT4_SUPER_MAGIC) {
        fail("mounted filesystem is not ext4");
    }

    int device_fd = open(device, O_RDONLY | O_CLOEXEC);
    if (device_fd < 0) {
        fail_errno("cannot open ORDAX block device");
    }

    struct ext4_disk_info before = read_ext4_disk_info(device_fd);
    if ((uint64_t)mounted.f_bsize != before.block_size) {
        close(device_fd);
        fail("mounted ext4 block size disagrees with its primary superblock");
    }

    uint64_t device_bytes = 0;
    if (ioctl(device_fd, BLKGETSIZE64, &device_bytes) != 0) {
        int saved = errno;
        close(device_fd);
        errno = saved;
        fail_errno("cannot read ORDAX block-device size");
    }

    uint64_t target_blocks = device_bytes / before.block_size;
    uint64_t current_blocks = before.blocks_count;
    if (target_blocks == 0) {
        close(device_fd);
        fail("computed target filesystem size is zero");
    }
    if (target_blocks <= current_blocks) {
        if (close(device_fd) != 0) {
            fail_errno("cannot close ORDAX block device");
        }
        printf("ORDAX_EXT4_GROWTH=NOT_NEEDED current_blocks=%" PRIu64 " target_blocks=%" PRIu64 " block_size=%" PRIu64 " device_bytes=%" PRIu64 "\n",
               current_blocks, target_blocks, before.block_size, device_bytes);
        return 0;
    }

    int mount_fd = open(mountpoint, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (mount_fd < 0) {
        close(device_fd);
        fail_errno("cannot open ORDAX mountpoint");
    }
    if (ioctl(mount_fd, EXT4_IOC_RESIZE_FS, &target_blocks) != 0) {
        int saved = errno;
        close(mount_fd);
        close(device_fd);
        errno = saved;
        fail_errno("kernel rejected online ext4 resize");
    }
    if (syncfs(mount_fd) != 0) {
        int saved = errno;
        close(mount_fd);
        close(device_fd);
        errno = saved;
        fail_errno("cannot persist resized ext4 metadata");
    }
    if (close(mount_fd) != 0) {
        int saved = errno;
        close(device_fd);
        errno = saved;
        fail_errno("cannot close ORDAX mountpoint");
    }

    struct ext4_disk_info after = read_ext4_disk_info(device_fd);
    if (close(device_fd) != 0) {
        fail_errno("cannot close ORDAX block device");
    }
    if (after.block_size != before.block_size ||
        after.blocks_per_group != before.blocks_per_group ||
        after.first_data_block != before.first_data_block) {
        fail("ext4 geometry changed unexpectedly during online resize");
    }

    uint64_t final_blocks = after.blocks_count;
    if (final_blocks <= current_blocks || final_blocks > target_blocks) {
        fail("online ext4 resize returned success without a valid filesystem growth");
    }

    uint64_t unused_tail_blocks = target_blocks - final_blocks;
    if (unused_tail_blocks != 0) {
        /*
         * ext4_resize_fs intentionally drops an undersized final block group
         * when that group cannot hold its required metadata. Accept only that
         * documented shape: less than one group remains and the filesystem
         * ends exactly on the preceding group boundary.
         */
        if (unused_tail_blocks >= before.blocks_per_group ||
            final_blocks < before.first_data_block ||
            ((final_blocks - before.first_data_block) % before.blocks_per_group) != 0) {
            fail("online ext4 resize left an unexplained unused device tail");
        }
    }

    printf("ORDAX_EXT4_GROWTH=PASS previous_blocks=%" PRIu64 " final_blocks=%" PRIu64 " target_blocks=%" PRIu64 " unused_tail_blocks=%" PRIu64 " block_size=%" PRIu64 " device_bytes=%" PRIu64 "\n",
           current_blocks, final_blocks, target_blocks, unused_tail_blocks, before.block_size, device_bytes);
    return 0;
}
