#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <linux/fs.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/types.h>
#include <unistd.h>

#ifndef EXT4_SUPER_MAGIC
#define EXT4_SUPER_MAGIC 0xEF53
#endif

#ifndef EXT4_IOC_RESIZE_FS
#define EXT4_IOC_RESIZE_FS _IOW('f', 16, uint64_t)
#endif

static void fail_errno(const char *message) {
    fprintf(stderr, "ordax-grow-ext4: %s: %s\n", message, strerror(errno));
    exit(1);
}

static void fail(const char *message) {
    fprintf(stderr, "ordax-grow-ext4: %s\n", message);
    exit(1);
}

static int real_block_device(const char *path) {
    struct stat st;
    if (lstat(path, &st) != 0) {
        return 0;
    }
    return S_ISBLK(st.st_mode);
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: ordax-grow-ext4 BLOCK_DEVICE MOUNTPOINT\n");
        return 2;
    }

    const char *device = argv[1];
    const char *mountpoint = argv[2];
    if (!real_block_device(device)) {
        fail("source is not a block device");
    }

    struct statfs before;
    if (statfs(mountpoint, &before) != 0) {
        fail_errno("cannot inspect mounted filesystem");
    }
    if ((unsigned long)before.f_type != (unsigned long)EXT4_SUPER_MAGIC) {
        fail("mounted filesystem is not ext4");
    }

    uint64_t block_size = before.f_frsize > 0 ? (uint64_t)before.f_frsize : (uint64_t)before.f_bsize;
    if (block_size < 1024 || block_size > 65536 || (block_size & (block_size - 1)) != 0) {
        fail("ext4 block size is outside the supported range");
    }

    int device_fd = open(device, O_RDONLY | O_CLOEXEC);
    if (device_fd < 0) {
        fail_errno("cannot open ORDAX block device");
    }
    uint64_t device_bytes = 0;
    if (ioctl(device_fd, BLKGETSIZE64, &device_bytes) != 0) {
        int saved = errno;
        close(device_fd);
        errno = saved;
        fail_errno("cannot read ORDAX block-device size");
    }
    if (close(device_fd) != 0) {
        fail_errno("cannot close ORDAX block device");
    }

    uint64_t target_blocks = device_bytes / block_size;
    uint64_t current_blocks = (uint64_t)before.f_blocks;
    if (target_blocks == 0) {
        fail("computed target filesystem size is zero");
    }
    if (target_blocks <= current_blocks) {
        printf("ORDAX_EXT4_GROWTH=NOT_NEEDED current_blocks=%" PRIu64 " target_blocks=%" PRIu64 " block_size=%" PRIu64 " device_bytes=%" PRIu64 "\n",
               current_blocks, target_blocks, block_size, device_bytes);
        return 0;
    }

    int mount_fd = open(mountpoint, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (mount_fd < 0) {
        fail_errno("cannot open ORDAX mountpoint");
    }
    if (ioctl(mount_fd, EXT4_IOC_RESIZE_FS, &target_blocks) != 0) {
        int saved = errno;
        close(mount_fd);
        errno = saved;
        fail_errno("kernel rejected online ext4 resize");
    }
    if (close(mount_fd) != 0) {
        fail_errno("cannot close ORDAX mountpoint");
    }
    sync();

    struct statfs after;
    if (statfs(mountpoint, &after) != 0) {
        fail_errno("cannot verify resized filesystem");
    }
    uint64_t final_blocks = (uint64_t)after.f_blocks;
    if (final_blocks < current_blocks || final_blocks < target_blocks) {
        fail("online ext4 resize returned success without reaching the partition capacity");
    }

    printf("ORDAX_EXT4_GROWTH=PASS previous_blocks=%" PRIu64 " final_blocks=%" PRIu64 " target_blocks=%" PRIu64 " block_size=%" PRIu64 " device_bytes=%" PRIu64 "\n",
           current_blocks, final_blocks, target_blocks, block_size, device_bytes);
    return 0;
}
