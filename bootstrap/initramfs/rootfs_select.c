#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define SHA_LEN 40
#define VALUE_CAP 64

static bool is_sha(const char *value) {
    if (value == NULL || strlen(value) != SHA_LEN) return false;
    for (size_t i = 0; i < SHA_LEN; ++i) {
        char ch = value[i];
        if (!((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f'))) return false;
    }
    return true;
}

static int join_path(char *out, size_t cap, const char *a, const char *b) {
    int n = snprintf(out, cap, "%s/%s", a, b);
    return (n > 0 && (size_t)n < cap) ? 0 : -1;
}

static int mkdir_one(const char *path, mode_t mode) {
    if (mkdir(path, mode) == 0 || errno == EEXIST) {
        struct stat st;
        if (lstat(path, &st) != 0 || !S_ISDIR(st.st_mode) || S_ISLNK(st.st_mode)) return -1;
        return 0;
    }
    return -1;
}

static int ensure_state_dir(const char *root, char *state, size_t cap) {
    char path[PATH_MAX];
    if (snprintf(state, cap, "%s/dev-base/state/ordax/base-update/rootfs", root) >= (int)cap) return -1;
    const char *parts[] = {
        "dev-base/state",
        "dev-base/state/ordax",
        "dev-base/state/ordax/base-update",
        "dev-base/state/ordax/base-update/rootfs",
    };
    for (size_t i = 0; i < sizeof(parts)/sizeof(parts[0]); ++i) {
        if (join_path(path, sizeof(path), root, parts[i]) != 0 || mkdir_one(path, 0700) != 0) return -1;
    }
    return 0;
}

static bool read_value(const char *dir, const char *name, char out[VALUE_CAP]) {
    char path[PATH_MAX];
    if (join_path(path, sizeof(path), dir, name) != 0) return false;
    int fd = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return false;
    struct stat st;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 48) {
        close(fd);
        return false;
    }
    ssize_t got = read(fd, out, VALUE_CAP - 1);
    close(fd);
    if (got <= 0 || got >= VALUE_CAP) return false;
    out[got] = '\0';
    while (got > 0 && (out[got - 1] == '\n' || out[got - 1] == '\r')) out[--got] = '\0';
    return is_sha(out);
}

static int sync_dir(const char *path) {
    int fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return -1;
    int rc = fsync(fd);
    close(fd);
    return rc;
}

static int write_value(const char *dir, const char *name, const char *value) {
    if (!is_sha(value)) return -1;
    char target[PATH_MAX], temp[PATH_MAX];
    if (join_path(target, sizeof(target), dir, name) != 0) return -1;
    int n = snprintf(temp, sizeof(temp), "%s/.%s.tmp.%ld", dir, name, (long)getpid());
    if (n <= 0 || (size_t)n >= sizeof(temp)) return -1;
    int fd = open(temp, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, 0600);
    if (fd < 0) return -1;
    char payload[SHA_LEN + 2];
    n = snprintf(payload, sizeof(payload), "%s\n", value);
    ssize_t wrote = write(fd, payload, (size_t)n);
    if (wrote != n || fsync(fd) != 0 || close(fd) != 0) {
        unlink(temp);
        return -1;
    }
    if (rename(temp, target) != 0) {
        unlink(temp);
        return -1;
    }
    return sync_dir(dir);
}

static void remove_value(const char *dir, const char *name) {
    char path[PATH_MAX];
    if (join_path(path, sizeof(path), dir, name) == 0) unlink(path);
}

static bool safe_regular_executable(const char *path) {
    struct stat st;
    if (lstat(path, &st) != 0 || !S_ISREG(st.st_mode) || S_ISLNK(st.st_mode)) return false;
    return (st.st_mode & 0111) != 0;
}

static bool version_valid(const char *root, const char *sha, char out[PATH_MAX]) {
    if (!is_sha(sha)) return false;
    int n = snprintf(out, PATH_MAX, "%s/dev-base/versions/%s", root, sha);
    if (n <= 0 || n >= PATH_MAX) return false;
    struct stat st;
    if (lstat(out, &st) != 0 || !S_ISDIR(st.st_mode) || S_ISLNK(st.st_mode)) return false;

    char marker[PATH_MAX], init[PATH_MAX];
    if (snprintf(marker, sizeof(marker), "%s/.ordax-rootfs-source", out) >= (int)sizeof(marker)) return false;
    char marker_value[VALUE_CAP] = {0};
    int fd = open(marker, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (fd < 0) return false;
    if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 48) {
        close(fd);
        return false;
    }
    ssize_t got = read(fd, marker_value, sizeof(marker_value) - 1);
    close(fd);
    if (got <= 0) return false;
    marker_value[got] = '\0';
    while (got > 0 && (marker_value[got - 1] == '\n' || marker_value[got - 1] == '\r')) marker_value[--got] = '\0';
    if (strcmp(marker_value, sha) != 0) return false;

    if (snprintf(init, sizeof(init), "%s/sbin/ordax-dev-init", out) >= (int)sizeof(init)) return false;
    return safe_regular_executable(init);
}

static void reject_booting(const char *state, const char *booting) {
    char pending[VALUE_CAP] = {0};
    if (is_sha(booting)) (void)write_value(state, "rejected", booting);
    if (read_value(state, "pending", pending) && strcmp(pending, booting) == 0) remove_value(state, "pending");
    remove_value(state, "booting");
    remove_value(state, "healthy");
    (void)sync_dir(state);
}

static int abort_boot(const char *root) {
    char state[PATH_MAX], booting[VALUE_CAP] = {0};
    if (ensure_state_dir(root, state, sizeof(state)) != 0) return 1;
    if (read_value(state, "booting", booting)) reject_booting(state, booting);
    return 0;
}

static int select_root(const char *root) {
    char legacy[PATH_MAX], state[PATH_MAX], path[PATH_MAX];
    if (snprintf(legacy, sizeof(legacy), "%s/dev-base", root) >= (int)sizeof(legacy)) return 1;
    if (ensure_state_dir(root, state, sizeof(state)) != 0) {
        puts(legacy);
        return 0;
    }

    char booting[VALUE_CAP] = {0}, healthy[VALUE_CAP] = {0};
    char pending[VALUE_CAP] = {0}, current[VALUE_CAP] = {0}, previous[VALUE_CAP] = {0};

    bool has_booting = read_value(state, "booting", booting);
    bool has_healthy = read_value(state, "healthy", healthy);

    if (has_booting) {
        if (has_healthy && strcmp(booting, healthy) == 0 && version_valid(root, booting, path)) {
            if (read_value(state, "current", current) && strcmp(current, booting) != 0 && version_valid(root, current, path)) {
                (void)write_value(state, "previous", current);
            }
            if (write_value(state, "current", booting) == 0) {
                if (read_value(state, "pending", pending) && strcmp(pending, booting) == 0) remove_value(state, "pending");
                remove_value(state, "booting");
                remove_value(state, "healthy");
                (void)sync_dir(state);
            }
        } else {
            reject_booting(state, booting);
        }
    } else if (has_healthy) {
        remove_value(state, "healthy");
        (void)sync_dir(state);
    }

    memset(pending, 0, sizeof(pending));
    if (read_value(state, "pending", pending)) {
        if (version_valid(root, pending, path)) {
            remove_value(state, "healthy");
            if (write_value(state, "booting", pending) == 0) {
                puts(path);
                return 0;
            }
        } else {
            (void)write_value(state, "rejected", pending);
            remove_value(state, "pending");
            (void)sync_dir(state);
        }
    }

    memset(current, 0, sizeof(current));
    if (read_value(state, "current", current) && version_valid(root, current, path)) {
        puts(path);
        return 0;
    }

    memset(previous, 0, sizeof(previous));
    if (read_value(state, "previous", previous) && version_valid(root, previous, path)) {
        puts(path);
        return 0;
    }

    puts(legacy);
    return 0;
}

int main(int argc, char **argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: ordax-rootfs-select <select|abort> <ordax-root>\n");
        return 2;
    }
    if (argv[2][0] != '/') return 2;
    if (strcmp(argv[1], "select") == 0) return select_root(argv[2]);
    if (strcmp(argv[1], "abort") == 0) return abort_boot(argv[2]);
    return 2;
}
