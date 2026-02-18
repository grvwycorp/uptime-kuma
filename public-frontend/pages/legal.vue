<script setup lang="ts">
useHead({ title: "Disclaimer & Privacy — Iris" });
</script>

<template>
    <div class="page">
        <NuxtLink to="/" class="back">&larr; Back to status</NuxtLink>

        <h1>Disclaimer &amp; Privacy</h1>

        <section>
            <h2>Accuracy Disclaimer</h2>
            <p>
                This status page displays data from independent automated monitoring
                and does not represent official status information from the listed
                service providers. Results may be affected by network conditions,
                probe location, or transient errors and may not reflect actual
                service availability.
            </p>
            <p>
                The information is provided "as is" without warranty of any kind.
                Do not use this page as the sole basis for operational decisions.
                Always verify with official service provider channels.
            </p>
        </section>

        <section>
            <h2>No Affiliation</h2>
            <p>
                This service is not affiliated with, endorsed by, or connected to
                any of the monitored service providers. All trademarks and service
                names belong to their respective owners.
            </p>
        </section>

        <section>
            <h2>Privacy</h2>
            <p>
                This site does not use cookies, tracking scripts, or analytics.
                No personal data is collected through the user interface.
            </p>
            <p>
                Standard web server access logs (IP address, user agent, timestamp)
                are retained for security and operational purposes and deleted on a
                rolling basis. This processing is based on legitimate interest under
                GDPR Article 6(1)(f).
            </p>
        </section>

        <section>
            <h2>Rate Limiting</h2>
            <p>
                API requests are rate-limited to 30 requests per minute per IP
                address. Automated scraping beyond this limit will receive HTTP 429
                responses.
            </p>
        </section>

        <section>
            <h2>Contact</h2>
            <p>
                For questions or concerns about this service, please open an issue
                on the project repository or contact the site operator.
            </p>
        </section>
    </div>
</template>

<style scoped>
.page {
    max-width: 640px;
    margin: 0 auto;
    padding: 40px 20px;
    color: #e0e0e8;
}

.back {
    display: inline-block;
    margin-bottom: 24px;
    color: #6b6b80;
    text-decoration: none;
    font-size: 14px;
}

.back:hover {
    color: #e0e0e8;
}

h1 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 28px;
    letter-spacing: -0.02em;
}

section {
    margin-bottom: 28px;
}

h2 {
    font-size: 15px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #e0e0e8;
}

p {
    font-size: 14px;
    line-height: 1.6;
    color: #a0a0b0;
    margin-bottom: 8px;
}
</style>
